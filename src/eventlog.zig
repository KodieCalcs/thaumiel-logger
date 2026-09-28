//! Animator-event logger (action-start hook, step 2 of docs/action-start-hook-plan.md).
//!
//! Hooks the anim-event ECS system's per-frame queue drain -- 3.3.3
//! `DIDDGLDPGMD::LKMGABPFJBM(CFDKCDCGKAG*)`, static, reached from
//! `DIDDGLDPGMD::WaitForFixedUpdate` -- and dumps the queue it is about to execute:
//! every `MoleMole.Config.AnimatorEvent` that fired on this entity this frame, of every
//! subclass (attack pattern, sound, effect, camera, ...), before predicate filtering. The
//! drain clears the list afterwards, so each event is seen exactly once.
//!
//! Queue entry (`AOGAEAMAHJG`, 24 bytes in the List<> backing array):
//!   +0x00 AnimatorEvent* event   +0x08 f32   +0x0C f32   +0x10 f32
//!   +0x14 i32 DIDDGLDPGMD.IAFKEKGEILL { All, ForceTriggerOnTransitionIn, ForceTrigger,
//!                                       ForceTriggerOnTransitionOut }
//! The enum is the point: the game tags events fired because an animator state was entered
//! or left. Class names come from il2cpp `class_get_name` through the dumper's verified table.
//!
//! Writes events.tsv in the capture folder (capture.zig: one folder per session, one per battle;
//! rotate() moves to the next battle's folder).

const std = @import("std");
const w = std.os.windows;

const nt = @import("nt.zig");
const dumper = @import("dumper.zig");
const capture = @import("capture.zig");
const Interception = @import("Interception.zig");

const log = std.log.scoped(.eventlog);

// --- the target ---------------------------------------------------------------

/// CNBetaWin3.3.4, re-derived 2026-09-25: the drain shape-matched 0.997 (153 vs 154
/// instructions) inside its structurally-matched class ODOHDPHKFIC (was DIDDGLDPGMD); the
/// ONLY displacement change in the whole body is the queue field below. Witness in
/// sheet-webapp/local-data/client-update-334/event_drain-diff.txt.
const drain_rva: usize = 0x13C42F30;

/// push rbp / r15 / r14 / rsi / rdi / rbx ; sub rsp, 0xA8 -- 15 bytes, position independent.
/// thaumiel's trampoline is 12 bytes, which would cut `sub rsp, imm32` in half, so the whole
/// 15-byte prologue is relocated and the stub jumps back to target+15.
const expected_prologue = [_]u8{ 0x55, 0x41, 0x57, 0x41, 0x56, 0x56, 0x57, 0x53, 0x48, 0x81, 0xEC, 0xA8, 0x00, 0x00, 0x00 };

/// Client PE identity; validated against the archived 3.3.4 GameAssembly.
const expected_timestamp: u32 = 0x6AB435F6;
const expected_size_of_image: u32 = 0x21714000;

// The per-entity anim-event component, 3.3.4 v7 dump.
const component_owner = 0x38; // inherited field the drain passes to every event's Execute; its `mov rdx,[r8+0x38]` read is byte-identical in 3.3.4
const component_queue = 0x50; // List of 24-byte queue entries (3.3.3: 0x138); the drain's only changed displacement

// System.Collections.Generic.List<T> and T[] layout as the drain itself reads them.
const list_items = 0x10;
const list_size = 0x18;
const array_length = 0x18;
const array_data = 0x20;
const entry_size = 24;

// --- bindings -----------------------------------------------------------------

extern "kernel32" fn GetModuleHandleA(?[*:0]const u8) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn VirtualAlloc(?*anyopaque, usize, u32, u32) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn GetTickCount64() callconv(.winapi) u64;
extern "kernel32" fn CreateFileA([*:0]const u8, u32, u32, ?*anyopaque, u32, u32, ?w.HANDLE) callconv(.winapi) w.HANDLE;
extern "kernel32" fn WriteFile(w.HANDLE, [*]const u8, u32, *u32, ?*anyopaque) callconv(.winapi) w.BOOL;
extern "kernel32" fn FlushFileBuffers(w.HANDLE) callconv(.winapi) w.BOOL;
extern "kernel32" fn CloseHandle(w.HANDLE) callconv(.winapi) w.BOOL;

/// Provided by event_hook.c.
extern var event_hook_original: u64;
extern fn event_hook_dispatch() callconv(.c) void;

const MEM_COMMIT_RESERVE: u32 = 0x1000 | 0x2000;
const PAGE_EXECUTE_READWRITE: u32 = 0x40;

// --- output -------------------------------------------------------------------

var out: ?w.HANDLE = null;
var buf: [32 << 10]u8 = undefined;
var len: usize = 0;
var rows: u64 = 0;
var table_state: enum { unchecked, ok, failed } = .unchecked;

fn flush() void {
    if (len == 0) return;
    if (out) |h| {
        var written: u32 = 0;
        _ = WriteFile(h, &buf, @intCast(len), &written, null);
        _ = FlushFileBuffers(h);
    }
    len = 0;
}

fn emit(comptime fmt: []const u8, args: anytype) void {
    if (len + 512 > buf.len) flush();
    const s = std.fmt.bufPrint(buf[len..], fmt, args) catch return;
    len += s.len;
}

// --- class-name cache -----------------------------------------------------------
// 132 AnimatorEvent subclasses exist; one class_get_name per distinct class is enough.

const NameEntry = struct { klass: u64 = 0, name: [64]u8 = undefined, n: usize = 0 };
var names: [256]NameEntry = undefined;
var name_count: usize = 0;

fn className(klass: u64) []const u8 {
    for (names[0..name_count]) |*e| if (e.klass == klass) return e.name[0..e.n];
    var tmp: [256]u8 = undefined;
    const got = dumper.className(@intCast(klass), &tmp) catch "?";
    if (name_count < names.len) {
        const e = &names[name_count];
        e.klass = klass;
        e.n = @min(got.len, e.name.len);
        @memcpy(e.name[0..e.n], got[0..e.n]);
        name_count += 1;
        return e.name[0..e.n];
    }
    return "?";
}

// --- reads -------------------------------------------------------------------
// Plain dereferences on the game thread, mid-frame, on the game's own live objects;
// null-checked only (as hitlog.zig).

fn readPtr(base: u64, off: usize) u64 {
    if (base == 0) return 0;
    return @as(*const u64, @ptrFromInt(@as(usize, @intCast(base)) + off)).*;
}
fn readI32(base: u64, off: usize) i32 {
    if (base == 0) return 0;
    return @as(*const i32, @ptrFromInt(@as(usize, @intCast(base)) + off)).*;
}
fn readF32(base: u64, off: usize) f32 {
    if (base == 0) return 0;
    return @as(*const f32, @ptrFromInt(@as(usize, @intCast(base)) + off)).*;
}

/// Called from event_hook.c at the top of every drain, i.e. once per entity per frame.
export fn eventlog_record(component: u64) callconv(.c) void {
    if (out == null) return;
    const list = readPtr(component, component_queue);
    const count = readI32(list, list_size);
    if (count <= 0) return; // the common case: nothing fired on this entity this frame
    // Unity has populated its API table long before the first animator event; validate it here,
    // on the game thread, rather than at DLL load when it is still empty.
    if (table_state == .unchecked) {
        dumper.validateTable() catch |err| {
            log.err("eventlog: API table validation failed ({t}); class names unavailable, logging pointers only", .{err});
            table_state = .failed;
        };
        if (table_state == .unchecked) table_state = .ok;
    }
    const items = readPtr(list, list_items);
    const capacity = readI32(items, array_length);
    const n: usize = @intCast(@min(count, capacity));
    const owner = readPtr(component, component_owner);
    const t = GetTickCount64() - capture.started;
    var i: usize = 0;
    while (i < n) : (i += 1) {
        const entry = items + array_data + i * entry_size;
        const event = readPtr(entry, 0);
        const klass = readPtr(event, 0);
        const name = if (table_state == .ok and klass != 0) className(klass) else "?";
        rows += 1;
        emit("{d}\t0x{X}\t0x{X}\t{d}\t{d}\t0x{X}\t0x{X}\t{s}\t{d:.6}\t{d:.6}\t{d:.6}\t{d}\n", .{
            t,
            component,
            owner,
            n,
            i,
            event,
            klass,
            name,
            readF32(entry, 0x08),
            readF32(entry, 0x0C),
            readF32(entry, 0x10),
            readI32(entry, 0x14),
        });
    }
    if (rows % 16 == 0) flush();
}

// --- install -------------------------------------------------------------------

fn install(syscall: *nt.Syscall) !void {
    const module = GetModuleHandleA("GameAssembly.dll") orelse return error.NoGameAssembly;
    const base = @intFromPtr(module);
    const e_lfanew = std.mem.readInt(u32, @as(*const [4]u8, @ptrFromInt(base + 0x3c)), .little);
    const timestamp = std.mem.readInt(u32, @as(*const [4]u8, @ptrFromInt(base + e_lfanew + 8)), .little);
    const size_of_image = std.mem.readInt(u32, @as(*const [4]u8, @ptrFromInt(base + e_lfanew + 0x50)), .little);
    if (timestamp != expected_timestamp or size_of_image != expected_size_of_image) {
        log.err("GameAssembly timestamp 0x{X} size 0x{X} != pinned 0x{X}/0x{X} -- wrong client version, not patching", .{ timestamp, size_of_image, expected_timestamp, expected_size_of_image });
        return error.ClientMismatch;
    }
    const target = base + drain_rva;
    const actual: *const [expected_prologue.len]u8 = @ptrFromInt(target);
    if (!std.mem.eql(u8, actual, &expected_prologue)) {
        log.err("prologue mismatch for the anim-event drain at 0x{X} -- wrong client version, not patching", .{target});
        return error.PrologueMismatch;
    }
    // Stub: the 15 relocated prologue bytes, then `jmp [rip+0]` + absolute address of target+15.
    const stub_len = expected_prologue.len + 6 + 8;
    const stub = VirtualAlloc(null, stub_len, MEM_COMMIT_RESERVE, PAGE_EXECUTE_READWRITE) orelse
        return error.StubAllocFailed;
    const bytes: [*]u8 = @ptrCast(stub);
    @memcpy(bytes[0..expected_prologue.len], actual);
    bytes[expected_prologue.len + 0] = 0xff;
    bytes[expected_prologue.len + 1] = 0x25;
    bytes[expected_prologue.len + 2] = 0x00;
    bytes[expected_prologue.len + 3] = 0x00;
    bytes[expected_prologue.len + 4] = 0x00;
    bytes[expected_prologue.len + 5] = 0x00;
    std.mem.writeInt(u64, bytes[expected_prologue.len + 6 ..][0..8], target + expected_prologue.len, .little);
    event_hook_original = @intFromPtr(stub);
    // The 12-byte trampoline lands inside `sub rsp, imm32`; bytes 12..14 stay as they were and
    // are never executed, since the entry now jumps away at byte 0.
    _ = try Interception.replace(syscall, target, event_hook_dispatch);
    log.info("hooked anim-event drain at 0x{X}, stub 0x{X}", .{ target, @intFromPtr(stub) });
}

/// Open `<battle folder>\events.tsv` with its header.
fn open() void {
    var path: capture.PathBuf = undefined;
    out = CreateFileA(capture.battlePath(&path, "events.tsv"), 0x40000000, 1, null, 2, 0x80, null);
    if (out == w.INVALID_HANDLE_VALUE) {
        out = null;
        log.err("could not create events.tsv", .{});
        return;
    }
    emit("elapsed_ms\tcomponent\towner\tqueued\tindex\tevent\tklass\tclassName\tf0\tf1\tf2\ttrigger\n", .{});
    flush();
}

/// Battle awake (capture.zig): finish the current file and open the next battle folder's.
pub fn rotate() void {
    flushAll();
    if (out) |h| _ = CloseHandle(h);
    out = null;
    open();
}

/// Everything buffered so far reaches the disk (battle destroy, capture.zig).
pub fn flushAll() void {
    flush();
    if (out) |h| _ = FlushFileBuffers(h);
}

pub fn start(syscall: *nt.Syscall) void {
    open();
    if (out == null) return;

    install(syscall) catch |err| {
        log.err("eventlog install failed: {t}", .{err});
        return;
    };
}
