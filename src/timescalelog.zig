//! 3.3.3 pins: docs/hooks-333-validation.md. The historical formula trace below is 3.3.2.
//! Global time-scale logger: every change of the scale the game applies to the whole level.
//!
//! The game never touches `UnityEngine.Time.timeScale` (the icall thunk at 3.3.2 `0x1FA0C670`
//! has no callers outside one BehaviorDesigner task; `Time.deltaTime` stays real). Instead the
//! level owns a time manager -- 3.3.2 `LOLPDHOFIHG : SingletonDisposable<>`, the class that
//! `PlayTimeSlowUtils::InvokeTimeSlowKey` tail-jumps into and `PinballSubsystem::
//! ResolvePinballWorldTimeScale` reads -- whose per-frame `Update(float dt)` is the one place the
//! global scale is applied (`disfn.py 3.3.2 0x136C9610`):
//!
//!     +0x7c  frame  += 1
//!     DNLBFPFCHPN(dt)                       -- advance the TimeSlow key stack, writes +0xbc
//!     scale  = +0xec ? 1.0 : +0xbc * +0xc4  -- +0xec is "run unscaled", not a pause
//!     +0xf4  = scale * dt                   -- the scaled delta
//!     +0xd0 += scale * dt                   -- accumulated world time
//!     EcsWorld::InnerStepTimeCenter(&dt, &scale); EcsSystemGroup::Update()
//!     if +0xc8 <= 0 ...                     -- pause counter; also zeroes FAOKGCLLACJ::get_DeltaTime
//!
//! Hooked after the call (timescale_hook.c), so every row reports exactly what the step just
//! applied. Per-entity scales (hitstop, the Witch slow-down zone) live on the entities' own
//! slot components (`CBDNNLPIJPB::BGKPJAFDPPP`) and are deliberately not logged here.
//!
//! Writes timescale.tsv in the battle folder (capture.zig), change-only:
//!
//!   elapsed_ms  scale  source  world_s  frame  raw  mult  unscaled  pause  dt
//!
//!   elapsed_ms  GetTickCount64 - capture.started, the origin hits.tsv/events.tsv share
//!   scale       the multiplier the step applied to dt (the game's own formula above)
//!   source      awake   the row written when the battle folder opens (last known state)
//!               update  Update ran and scale / unscaled / pause changed (or first after awake)
//!               gap     no Update for > 100 ms: written at the LAST Update's time, before the
//!                       `update` row of the one that resumed -- world_s on both is the truth
//!   world_s     +0xd0, the game's own integral of scale * dt (float, seconds)
//!   frame       +0x7c
//!   raw, mult   +0xbc, +0xc4 (scale = raw * mult unless unscaled)
//!   unscaled    +0xec        pause  +0xc8        dt  the step's argument, seconds
//!
//! Class, method and field names are obfuscated and CHANGE EVERY BUILD (3.3.0 called the class
//! GNCGBEDJJJE with a different layout). Re-find: InvokeTimeSlowKey's tail `jmp` names the class;
//! its `Update/1` disassembly gives the offsets. Resolved by name through the dumper, then every
//! offset is checked against the pins below and the prologue against the bytes below; any
//! mismatch installs nothing and is logged under `timescale`.

const std = @import("std");
const w = std.os.windows;

const nt = @import("nt.zig");
const dumper = @import("dumper.zig");
const capture = @import("capture.zig");
const Interception = @import("Interception.zig");

const log = std.log.scoped(.timescale);

// --- the target (CNBetaWin3.3.4, v7 dump) ------------------------------
// Re-derived 2026-09-25: the class matched structurally with one candidate, and its named
// Update/1 shape-matched 1.0 over all 329 instructions (witness in
// sheet-webapp/local-data/client-update-334/timescale_update-diff.txt). Fields below are the
// displacement changes inside that 100%-aligned body, named from the dump afterwards.

const class_name = "FEIGLFFGABJ";
const expected_update_rva: usize = 0x1942A6A0;

/// push rsi; push rdi; push rbx; sub rsp,0x50; movaps [rsp+0x40],xmm7 -- exactly the 12 bytes
/// thaumiel's trampoline overwrites, all position independent; relocated verbatim.
const expected_prologue = [_]u8{ 0x56, 0x57, 0x53, 0x48, 0x83, 0xEC, 0x50, 0x0F, 0x29, 0x7C, 0x24, 0x40 };

const Field = struct { name: []const u8, offset: usize };
const f_frame: Field = .{ .name = "MGDAMOEKKHB", .offset = 0xb4 };
const f_raw: Field = .{ .name = "CEBCLBBMGPL", .offset = 0x78 };
const f_mult: Field = .{ .name = "<ECBKLOMGKAH>k__BackingField", .offset = 0xe0 };
const f_pause: Field = .{ .name = "DOPCCDPPNLN", .offset = 0xb0 };
const f_world: Field = .{ .name = "FLNNELBLDNL", .offset = 0xd0 };
const f_unscaled: Field = .{ .name = "JHBFGEGDKCN", .offset = 0x95 };
const f_scaled_dt: Field = .{ .name = "NJBFIEIIMIK", .offset = 0xf8 };

/// A frame this long without an Update is reported as a gap (normal frames are ~16 ms).
const gap_ms: u64 = 100;

// --- bindings -----------------------------------------------------------------

extern "kernel32" fn GetModuleHandleA(?[*:0]const u8) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn VirtualAlloc(?*anyopaque, usize, u32, u32) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn GetTickCount64() callconv(.winapi) u64;
extern "kernel32" fn CreateFileA([*:0]const u8, u32, u32, ?*anyopaque, u32, u32, ?w.HANDLE) callconv(.winapi) w.HANDLE;
extern "kernel32" fn WriteFile(w.HANDLE, [*]const u8, u32, *u32, ?*anyopaque) callconv(.winapi) w.BOOL;
extern "kernel32" fn FlushFileBuffers(w.HANDLE) callconv(.winapi) w.BOOL;
extern "kernel32" fn CloseHandle(w.HANDLE) callconv(.winapi) w.BOOL;

/// Provided by timescale_hook.c.
extern var timescale_hook_original: u64;
extern fn timescale_hook_update() callconv(.c) void;

const MEM_COMMIT_RESERVE: u32 = 0x1000 | 0x2000;
const PAGE_EXECUTE_READWRITE: u32 = 0x40;

// --- output -------------------------------------------------------------------

var out: ?w.HANDLE = null;
var buf: [8 << 10]u8 = undefined;
var len: usize = 0;

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
    if (len + 256 > buf.len) flush();
    const s = std.fmt.bufPrint(buf[len..], fmt, args) catch return;
    len += s.len;
}

// --- state ----------------------------------------------------------------------

/// What the last Update applied; the `awake` row repeats it and change detection compares to it.
const State = struct {
    scale: f32 = 1.0,
    world: f32 = 0,
    frame: i32 = 0,
    raw: f32 = 1.0,
    mult: f32 = 1.0,
    unscaled: u8 = 0,
    pause: i32 = 0,
    dt: f32 = 0,
};
var last: State = .{};
var seen_update = false;
var last_update_wall: u64 = 0;
/// GetTickCount64 at the last Update that ran paused (+0xc8 > 0); capture.zig reads it at battle
/// destroy to tell a battle left through the pause menu from a finished one.
pub var last_pause_wall: u64 = 0;
/// Set by rotate(): the next Update writes a row whether or not anything changed.
var force_next = true;

fn readF32(base: u64, off: usize) f32 {
    return @as(*const f32, @ptrFromInt(@as(usize, @intCast(base)) + off)).*;
}
fn readI32(base: u64, off: usize) i32 {
    return @as(*const i32, @ptrFromInt(@as(usize, @intCast(base)) + off)).*;
}
fn readU8(base: u64, off: usize) u8 {
    return @as(*const u8, @ptrFromInt(@as(usize, @intCast(base)) + off)).*;
}

fn row(t: u64, source: []const u8, s: State) void {
    emit("{d}\t{d}\t{s}\t{d}\t{d}\t{d}\t{d}\t{d}\t{d}\t{d}\n", .{
        t, s.scale, source, s.world, s.frame, s.raw, s.mult, s.unscaled, s.pause, s.dt,
    });
    flush(); // rows are rare; every one reaches the disk at once
}

/// Called from timescale_hook.c after every `LOLPDHOFIHG::Update(dt)`, on the game thread.
export fn timescalelog_record(self: u64, dt: f32) callconv(.c) void {
    if (out == null or self == 0) return;
    const now = GetTickCount64();
    const t = now - capture.started;
    var s: State = .{
        .world = readF32(self, f_world.offset),
        .frame = readI32(self, f_frame.offset),
        .raw = readF32(self, f_raw.offset),
        .mult = readF32(self, f_mult.offset),
        .unscaled = readU8(self, f_unscaled.offset),
        .pause = readI32(self, f_pause.offset),
        .dt = dt,
    };
    // The step's own formula (module comment); +0xf4 = scale * dt would divide by a zero dt.
    s.scale = if (s.unscaled != 0) 1.0 else s.raw * s.mult;
    if (s.pause != 0) last_pause_wall = now;
    if (seen_update and now - last_update_wall > gap_ms) {
        // Report the stall at the previous step's time; the row below is the resumption.
        row(last_update_wall - capture.started, "gap", last);
        force_next = true;
    }
    const changed = force_next or
        @as(u32, @bitCast(s.scale)) != @as(u32, @bitCast(last.scale)) or
        s.unscaled != last.unscaled or s.pause != last.pause;
    if (changed) row(t, "update", s);
    last = s;
    seen_update = true;
    last_update_wall = now;
    force_next = false;
}

// --- install -------------------------------------------------------------------

const Resolved = struct { update: usize };

fn checkField(klass: usize, f: Field) !void {
    const off = dumper.findField(klass, f.name) catch |err| {
        log.err("lookup {s}.{s} failed: {t}", .{ class_name, f.name, err });
        return err;
    };
    if (off != f.offset) {
        log.err("{s}.{s} is at +0x{X}, pinned +0x{X} -- layout changed, not patching", .{ class_name, f.name, off, f.offset });
        return error.FieldOffsetMismatch;
    }
}

fn resolve(base: usize) !Resolved {
    try dumper.beginLookup();
    defer dumper.endLookup();
    const klass = dumper.findClass("", class_name) catch |err| {
        log.err("lookup {s} failed: {t} (obfuscated name; re-find via InvokeTimeSlowKey, see module comment)", .{ class_name, err });
        return err;
    };
    const update = dumper.findMethod(klass, "Update", 1) catch |err| {
        log.err("lookup {s}::Update/1 failed: {t}", .{ class_name, err });
        return err;
    };
    if (update - base != expected_update_rva) {
        log.err("{s}::Update/1 resolved to RVA 0x{X}, pinned 0x{X} -- not patching", .{ class_name, update - base, expected_update_rva });
        return error.RvaMismatch;
    }
    inline for (.{ f_frame, f_raw, f_mult, f_pause, f_world, f_unscaled, f_scaled_dt }) |f| try checkField(klass, f);
    return .{ .update = update };
}

fn install(syscall: *nt.Syscall, target: usize) !void {
    const actual: *const [expected_prologue.len]u8 = @ptrFromInt(target);
    if (!std.mem.eql(u8, actual, &expected_prologue)) {
        log.err("prologue mismatch for {s}::Update at 0x{X} ({x}) -- not patching", .{ class_name, target, actual });
        return error.PrologueMismatch;
    }
    // Stub: the 12 relocated bytes, then `jmp [rip+0]` + absolute target+12 (as hitlog.installOne).
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
    timescale_hook_original = @intFromPtr(stub);
    _ = try Interception.replace(syscall, target, timescale_hook_update);
    log.info("hooked {s}::Update at 0x{X}, stub 0x{X}", .{ class_name, target, @intFromPtr(stub) });
}

/// Called only by dumper's worker after capture.installFromWorker(): il2cpp is up and the
/// verified API table is available for the name lookups.
pub fn installFromWorker() void {
    if (out == null) {
        log.err("timescale install refused: timescale.tsv is not open", .{});
        return;
    }
    const base = @intFromPtr(GetModuleHandleA("GameAssembly.dll") orelse {
        log.err("timescale hook: no GameAssembly.dll", .{});
        return;
    });
    const targets = resolve(base) catch return;
    var syscall: nt.Syscall = .init;
    install(&syscall, targets.update) catch |err| {
        log.err("timescale hook failed: {t}", .{err});
        return;
    };
    log.info("time-scale hook installed; logging changes to timescale.tsv", .{});
}

// --- lifecycle -------------------------------------------------------------------

/// Open `<battle folder>\timescale.tsv` with its header and the `awake` row.
fn open() void {
    var path: capture.PathBuf = undefined;
    out = CreateFileA(capture.battlePath(&path, "timescale.tsv"), 0x40000000, 1, null, 2, 0x80, null);
    if (out == w.INVALID_HANDLE_VALUE) {
        out = null;
        log.err("could not create timescale.tsv", .{});
        return;
    }
    emit("elapsed_ms\tscale\tsource\tworld_s\tframe\traw\tmult\tunscaled\tpause\tdt\n", .{});
    // The file never starts undefined: the last state the step applied (1.0 before any step).
    row(GetTickCount64() - capture.started, "awake", last);
}

/// Battle awake (capture.zig): finish the current file and open the next battle folder's. The
/// next Update logs unconditionally, so the new level's own state follows the `awake` row.
pub fn rotate() void {
    flushAll();
    if (out) |h| _ = CloseHandle(h);
    out = null;
    open();
    force_next = true;
    seen_update = false;
}

/// Everything buffered so far reaches the disk (battle destroy, capture.zig).
pub fn flushAll() void {
    flush();
    if (out) |h| _ = FlushFileBuffers(h);
}

pub fn start() void {
    open();
}
