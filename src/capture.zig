//! Capture layout and battle lifecycle: where every log file goes, and when it rotates.
//!
//! Everything lives under `Combat Logs\` beside remielle.exe (names in capture_names.zig):
//!
//!   Combat Logs\2026-09-28\Battle 3 - 14.05\   one folder per battle, numbered through the day;
//!                                              only combat-log.csv and summary.json are visible,
//!                                              the raw logs (hits.tsv, events.tsv, damage-*.tsv,
//!                                              ...) are hidden in place
//!   Combat Logs\.diagnostics\<launch>\         hidden: hitlog-startup.log, damage-probe-status.txt,
//!                                              il2cpp-v7.*, and lobby\ (launch -> first battle)
//!   Combat Logs\.tools\                        hidden: the summarizer, run at each battle's end
//!
//! Every reader (per-hit-log.mjs, name-capture-states.mjs, import-rotation.mjs, ...) takes a
//! battle folder by path and reads the hidden files like any other. Captures made before
//! 2026-09-28 use `captures\<UTC stamp>-<pid>\battle-<n>\`; the readers do not care which.
//!
//! The battle signal is `MoleMole.BattleStatsSubsystem`: a `GameSubsystemBase` (created with the
//! level and destroyed with it, unlike the `GlobalSubsystemBase` family) that collects the
//! settlement report. Its `OnAwake` rotates every log -- hits.tsv, events.tsv, the damage-*
//! probes -- and resets the shared clock origin, so `elapsed_ms` reads as time since the battle
//! awoke and the two runs of a session cannot be confused. `OnDestroy` only flushes: rows after
//! it (the result screen, the lobby) stay in the battle's folder, and if awake never fires the
//! whole session stays in the diagnostics lobby\ folder. Both
//! methods are resolved by name through the dumper's verified il2cpp metadata API, like the hit
//! hooks; a lookup or prologue failure installs nothing and is logged.
//!
//! Prologues (3.3.2, `tools/discovery/disfn.py 3.3.2 0x169DEF20` / `0x169DF020`):
//!   OnDestroy  push rbp; push rsi; push rdi; sub rsp,0x60; lea rbp,[rsp+0x60]  -- 12 bytes,
//!              position independent, relocated verbatim (thaumiel's trampoline is 12 bytes).
//!   OnAwake    push rsi; push rdi; push rbx; sub rsp,0x20; mov rsi,rcx  -- 10 bytes, then a
//!              7-byte `cmp byte ptr [rip+disp32], 0`. The stub re-encodes that compare as
//!              `mov rax, abs; cmp byte ptr [rax], 0` (rax is dead at entry: first written at
//!              +0x31) and jumps back to +17, where the original `je` reads the flags. The
//!              trampoline's bytes 12..16 land in the compare's tail and are never executed;
//!              no branch in the function targets the first 17 bytes.

const std = @import("std");
const w = std.os.windows;

const nt = @import("nt.zig");
const dumper = @import("dumper.zig");
const hitlog = @import("hitlog.zig");
const eventlog = @import("eventlog.zig");
const timescalelog = @import("timescalelog.zig");
const statelog = @import("statelog.zig");
const Interception = @import("Interception.zig");

const log = std.log.scoped(.capture);

// --- bindings -----------------------------------------------------------------

const names = @import("capture_names.zig");
const SystemTime = names.SystemTime;
pub const root_dir = names.root_dir;
extern "kernel32" fn GetLocalTime(*SystemTime) callconv(.winapi) void;
extern "kernel32" fn GetTickCount64() callconv(.winapi) u64;
extern "kernel32" fn CreateDirectoryA([*:0]const u8, ?*anyopaque) callconv(.winapi) w.BOOL;
extern "kernel32" fn GetModuleHandleA(?[*:0]const u8) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn VirtualAlloc(?*anyopaque, usize, u32, u32) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn GetFileAttributesA([*:0]const u8) callconv(.winapi) u32;
extern "kernel32" fn SetFileAttributesA([*:0]const u8, u32) callconv(.winapi) w.BOOL;
extern "kernel32" fn FindFirstFileA([*:0]const u8, *FindData) callconv(.winapi) w.HANDLE;
extern "kernel32" fn FindNextFileA(w.HANDLE, *FindData) callconv(.winapi) w.BOOL;
extern "kernel32" fn FindClose(w.HANDLE) callconv(.winapi) w.BOOL;

/// WIN32_FIND_DATAA.
const FindData = extern struct {
    attributes: u32,
    creation_time: [2]u32,
    last_access_time: [2]u32,
    last_write_time: [2]u32,
    size_high: u32,
    size_low: u32,
    reserved0: u32,
    reserved1: u32,
    file_name: [260]u8,
    alternate_file_name: [14]u8,
};
const INVALID_ATTRIBUTES: u32 = 0xFFFFFFFF;
const ATTRIBUTE_HIDDEN: u32 = 0x2;
const ATTRIBUTE_DIRECTORY: u32 = 0x10;

/// damage_probe.c: the probes open their files in the battle folder and reopen them on rotate.
extern fn damage_probe_set_dirs(session_dir: [*:0]const u8, battle_dir: [*:0]const u8) callconv(.c) void;
extern fn damage_probe_rotate(battle_dir: [*:0]const u8, now: u64) callconv(.c) void;
extern fn damage_probe_flush() callconv(.c) void;

/// Provided by battle_hook.c; each detour tail-calls through its own stub.
extern var battle_hook_original_awake: u64;
extern var battle_hook_original_destroy: u64;
extern fn battle_hook_awake() callconv(.c) void;
extern fn battle_hook_destroy() callconv(.c) void;

const MEM_COMMIT_RESERVE: u32 = 0x1000 | 0x2000;
const PAGE_EXECUTE_READWRITE: u32 = 0x40;

// --- layout -------------------------------------------------------------------

pub const PathBuf = [260]u8;

/// Clock origin shared by hitlog.zig and eventlog.zig (`elapsed_ms`); reset on every battle awake.
pub var started: u64 = 0;
/// Number of awakes seen this launch (0 = before the first battle). The number in a battle
/// folder's name is per day instead, one past the highest already in that day's folder.
pub var battle: u32 = 0;

var session_dir: PathBuf = undefined; // "Combat Logs\.diagnostics\<launch>\"
var session_len: usize = 0;
var battle_dir: PathBuf = undefined; // "Combat Logs\<day>\Battle <n> - <time>\", or "<session>lobby\"
var battle_len: usize = 0;

fn sessionDirZ() [*:0]const u8 {
    return @ptrCast(session_dir[0..session_len :0]);
}
fn battleDirZ() [*:0]const u8 {
    return @ptrCast(battle_dir[0..battle_len :0]);
}

/// `<diagnostics>\<launch>\<name>` -- the per-launch files (startup log, probe status, il2cpp dump).
pub fn sessionPath(buf: *PathBuf, name: []const u8) [*:0]const u8 {
    const s = std.fmt.bufPrintZ(buf, "{s}{s}", .{ session_dir[0..session_len], name }) catch unreachable;
    return s.ptr;
}

/// `<battle folder>\<name>` -- the per-battle logs.
pub fn battlePath(buf: *PathBuf, name: []const u8) [*:0]const u8 {
    const s = std.fmt.bufPrintZ(buf, "{s}{s}", .{ battle_dir[0..battle_len], name }) catch unreachable;
    return s.ptr;
}

/// Mark a file or folder hidden, keeping its other attributes.
pub fn hide(path: [*:0]const u8) void {
    const attributes = GetFileAttributesA(path);
    if (attributes == INVALID_ATTRIBUTES or attributes & ATTRIBUTE_HIDDEN != 0) return;
    _ = SetFileAttributesA(path, attributes | ATTRIBUTE_HIDDEN);
}

/// Hide every file in the current battle folder except the summarizer's two outputs, so a player
/// opening it sees combat-log.csv and summary.json. The raw logs stay where every reader expects
/// them; setting the attribute works on files this process still has open.
fn hideRawFiles() void {
    if (battle == 0) return; // the lobby folder is inside the hidden diagnostics folder
    var pattern: PathBuf = undefined;
    const p = std.fmt.bufPrintZ(&pattern, "{s}*", .{battle_dir[0..battle_len]}) catch return;
    var data: FindData = undefined;
    const handle = FindFirstFileA(p.ptr, &data);
    if (handle == w.INVALID_HANDLE_VALUE) return;
    defer _ = FindClose(handle);
    while (true) {
        const name = std.mem.sliceTo(&data.file_name, 0);
        if (data.attributes & ATTRIBUTE_DIRECTORY == 0 and !names.isVisibleOutput(name)) {
            var path: PathBuf = undefined;
            hide(battlePath(&path, name));
        }
        if (FindNextFileA(handle, &data) == .FALSE) break;
    }
}

/// One past the highest "Battle <n>" folder already in `day_dir`, so battles keep counting
/// across launches on the same day.
fn nextBattleNumber(day_dir: []const u8) u32 {
    var pattern: PathBuf = undefined;
    const p = std.fmt.bufPrintZ(&pattern, "{s}Battle *", .{day_dir}) catch return 1;
    var data: FindData = undefined;
    const handle = FindFirstFileA(p.ptr, &data);
    if (handle == w.INVALID_HANDLE_VALUE) return 1;
    defer _ = FindClose(handle);
    var highest: u32 = 0;
    while (true) {
        if (data.attributes & ATTRIBUTE_DIRECTORY != 0) {
            if (names.battleNumber(std.mem.sliceTo(&data.file_name, 0))) |n| highest = @max(highest, n);
        }
        if (FindNextFileA(handle, &data) == .FALSE) break;
    }
    return highest + 1;
}

fn setBattleDir() void {
    if (battle == 0) {
        const s = std.fmt.bufPrintZ(&battle_dir, "{s}lobby\\", .{session_dir[0..session_len]}) catch unreachable;
        battle_len = s.len;
        _ = CreateDirectoryA(battleDirZ(), null);
        return;
    }
    var now: SystemTime = undefined;
    GetLocalTime(&now);
    var day_buf: PathBuf = undefined;
    var day_name: [16]u8 = undefined;
    const day = std.fmt.bufPrintZ(&day_buf, root_dir ++ "\\{s}\\", .{names.dayFolderName(&day_name, now)}) catch unreachable;
    _ = CreateDirectoryA(day.ptr, null);
    var name: [64]u8 = undefined;
    const s = std.fmt.bufPrintZ(&battle_dir, "{s}{s}\\", .{ day, names.battleFolderName(&name, nextBattleNumber(day), now) }) catch unreachable;
    battle_len = s.len;
    _ = CreateDirectoryA(battleDirZ(), null);
}

/// Create `Combat Logs\.diagnostics\<launch>\lobby\` and start the clock. Must run before any log
/// opens. No battle folder exists until a battle starts.
pub fn start() void {
    var now: SystemTime = undefined;
    GetLocalTime(&now);
    _ = CreateDirectoryA(root_dir, null);
    _ = CreateDirectoryA(names.diagnostics_dir, null);
    hide(names.diagnostics_dir);
    hide(names.tools_dir); // a zip does not carry the hidden attribute
    var attempt: u32 = 1;
    while (true) : (attempt += 1) {
        var name: [64]u8 = undefined;
        const s = std.fmt.bufPrintZ(&session_dir, names.diagnostics_dir ++ "\\{s}\\", .{names.launchFolderName(&name, now, attempt)}) catch unreachable;
        session_len = s.len;
        // A launch in the same second as an earlier one gets its own folder, never a shared one.
        if (CreateDirectoryA(sessionDirZ(), null) != .FALSE or attempt >= 9) break;
    }
    battle = 0;
    setBattleDir();
    started = GetTickCount64();
    damage_probe_set_dirs(sessionDirZ(), battleDirZ());
}

/// Run the summarizer in the background for every battle without a summary yet (the one that
/// just ended included): `Combat Logs\.tools\summarize.mjs` under the bundled node, else a node
/// on PATH. Does nothing if the tools are not installed; with no node, CreateProcess just fails.
fn startSummarizer() void {
    if (GetFileAttributesA(names.tools_dir ++ "\\summarize.mjs") == INVALID_ATTRIBUTES) return;
    const args = " \"" ++ names.tools_dir ++ "\\summarize.mjs\" --pending \"" ++ root_dir ++ "\"";
    const bundled = std.unicode.utf8ToUtf16LeStringLiteral("\"" ++ names.tools_dir ++ "\\node\\node.exe\"" ++ args);
    const on_path = std.unicode.utf8ToUtf16LeStringLiteral("node" ++ args);
    const has_bundled = GetFileAttributesA(names.tools_dir ++ "\\node\\node.exe") != INVALID_ATTRIBUTES;
    const command: []const u16 = if (has_bundled) bundled else on_path;
    // CreateProcessW may write to the command line, so it gets a copy.
    var buffer: [512:0]u16 = undefined;
    @memcpy(buffer[0..command.len], command);
    buffer[command.len] = 0;
    var startup_info = std.mem.zeroes(w.STARTUPINFOW);
    startup_info.cb = @sizeOf(w.STARTUPINFOW);
    var process_info: w.PROCESS.INFORMATION = undefined;
    if (w.kernel32.CreateProcessW(null, &buffer, null, null, .FALSE, .{ .create_no_window = true, .below_normal_priority_class = true }, null, null, &startup_info, &process_info) == .FALSE) {
        log.info("summarizer not started (bundled node: {}); is Node.js installed?", .{has_bundled});
        return;
    }
    _ = w.ntdll.NtClose(process_info.hThread);
    _ = w.ntdll.NtClose(process_info.hProcess);
    log.info("summarizer started", .{});
}

// --- lifecycle ------------------------------------------------------------------

/// Called from battle_hook.c at BattleStatsSubsystem::OnAwake, on the game thread before the
/// level runs: the next battle folder opens and every log moves into it.
export fn capture_battle_awake(self: u64) callconv(.c) void {
    const previous = battle;
    const elapsed = GetTickCount64() - started;
    battle += 1;
    setBattleDir();
    started = GetTickCount64();
    hitlog.rotate();
    eventlog.rotate();
    timescalelog.rotate();
    statelog.rotate();
    damage_probe_rotate(battleDirZ(), started);
    hideRawFiles();
    log.info("battle {d} awake (subsystem 0x{X}) {d} ms after battle {d} began; logging to {s}", .{ battle, self, elapsed, previous, battle_dir[0..battle_len] });
}

/// Called at BattleStatsSubsystem::OnDestroy: the level is going away, so make the battle's
/// files complete on disk and summarize it. Nothing closes -- see the module comment.
export fn capture_battle_destroy(self: u64) callconv(.c) void {
    hitlog.flushAll();
    eventlog.flushAll();
    timescalelog.flushAll();
    statelog.flushAll();
    damage_probe_flush();
    hideRawFiles(); // catches files opened after the awake pass
    startSummarizer();
    log.info("battle {d} destroyed (subsystem 0x{X}) at {d} ms", .{ battle, self, GetTickCount64() - started });
}

// --- install ------------------------------------------------------------------

const awake_prologue = [_]u8{ 0x56, 0x57, 0x53, 0x48, 0x83, 0xEC, 0x20, 0x48, 0x89, 0xCE };
const awake_reloc = awake_prologue.len + 7; // + `cmp byte ptr [rip+disp32], 0`
const destroy_prologue = [_]u8{ 0x55, 0x56, 0x57, 0x48, 0x83, 0xEC, 0x60, 0x48, 0x8D, 0x6C, 0x24, 0x60 };

fn awakeMatches(actual: *const [awake_reloc]u8) bool {
    return std.mem.eql(u8, actual[0..awake_prologue.len], &awake_prologue) and actual[10] == 0x80 and actual[11] == 0x3D and actual[16] == 0x00;
}

fn jmpAbs(bytes: [*]u8, at: usize, target: usize) void {
    bytes[at + 0] = 0xff; // jmp [rip+0]
    bytes[at + 1] = 0x25;
    bytes[at + 2] = 0x00;
    bytes[at + 3] = 0x00;
    bytes[at + 4] = 0x00;
    bytes[at + 5] = 0x00;
    std.mem.writeInt(u64, bytes[at + 6 ..][0..8], target, .little);
}

/// OnDestroy: 12 verbatim bytes, then jump to target+12 (as hitlog.installOne).
fn installDestroy(syscall: *nt.Syscall, target: usize) !void {
    const actual: *const [destroy_prologue.len]u8 = @ptrFromInt(target);
    if (!std.mem.eql(u8, actual, &destroy_prologue)) {
        log.err("prologue mismatch for BattleStatsSubsystem::OnDestroy at 0x{X} -- not patching", .{target});
        return error.PrologueMismatch;
    }
    const stub_len = destroy_prologue.len + 14;
    const stub = VirtualAlloc(null, stub_len, MEM_COMMIT_RESERVE, PAGE_EXECUTE_READWRITE) orelse return error.StubAllocFailed;
    const bytes: [*]u8 = @ptrCast(stub);
    @memcpy(bytes[0..destroy_prologue.len], actual);
    jmpAbs(bytes, destroy_prologue.len, target + destroy_prologue.len);
    battle_hook_original_destroy = @intFromPtr(stub);
    _ = try Interception.replace(syscall, target, battle_hook_destroy);
    log.info("hooked BattleStatsSubsystem::OnDestroy at 0x{X}, stub 0x{X}", .{ target, @intFromPtr(stub) });
}

/// OnAwake: 10 verbatim bytes, the RIP-relative compare re-encoded through rax, jump to +17.
fn installAwake(syscall: *nt.Syscall, target: usize) !void {
    const actual: *const [awake_reloc]u8 = @ptrFromInt(target);
    if (!awakeMatches(actual)) {
        log.err("prologue mismatch for BattleStatsSubsystem::OnAwake at 0x{X} -- not patching", .{target});
        return error.PrologueMismatch;
    }
    const disp = std.mem.readInt(i32, actual[12..16], .little);
    const operand: u64 = @intCast(@as(i64, @intCast(target + awake_reloc)) + disp);
    const stub_len = awake_prologue.len + 10 + 3 + 14;
    const stub = VirtualAlloc(null, stub_len, MEM_COMMIT_RESERVE, PAGE_EXECUTE_READWRITE) orelse return error.StubAllocFailed;
    const bytes: [*]u8 = @ptrCast(stub);
    @memcpy(bytes[0..awake_prologue.len], actual[0..awake_prologue.len]);
    var at = awake_prologue.len;
    bytes[at] = 0x48; // mov rax, imm64
    bytes[at + 1] = 0xB8;
    std.mem.writeInt(u64, bytes[at + 2 ..][0..8], operand, .little);
    at += 10;
    bytes[at] = 0x80; // cmp byte ptr [rax], 0
    bytes[at + 1] = 0x38;
    bytes[at + 2] = 0x00;
    at += 3;
    jmpAbs(bytes, at, target + awake_reloc);
    battle_hook_original_awake = @intFromPtr(stub);
    _ = try Interception.replace(syscall, target, battle_hook_awake);
    log.info("hooked BattleStatsSubsystem::OnAwake at 0x{X}, stub 0x{X} (flag byte 0x{X})", .{ target, @intFromPtr(stub), operand });
}

fn resolve() !struct { awake: usize, destroy: usize } {
    try dumper.beginLookup();
    defer dumper.endLookup();
    const klass = dumper.findClass("MoleMole", "BattleStatsSubsystem") catch |err| {
        log.err("lookup MoleMole.BattleStatsSubsystem failed: {t}", .{err});
        return err;
    };
    const awake = dumper.findMethod(klass, "OnAwake", 0) catch |err| {
        log.err("lookup BattleStatsSubsystem::OnAwake failed: {t}", .{err});
        return err;
    };
    const destroy = dumper.findMethod(klass, "OnDestroy", 0) catch |err| {
        log.err("lookup BattleStatsSubsystem::OnDestroy failed: {t}", .{err});
        return err;
    };
    return .{ .awake = awake, .destroy = destroy };
}

/// Called only by dumper's worker after hitlog.installFromWorker(); both prologues are checked
/// before either patch is written.
pub fn installFromWorker() void {
    const base = @intFromPtr(GetModuleHandleA("GameAssembly.dll") orelse {
        log.err("battle hooks: no GameAssembly.dll", .{});
        return;
    });
    const targets = resolve() catch return;
    log.info("BattleStatsSubsystem::OnAwake RVA 0x{X}, OnDestroy RVA 0x{X}", .{ targets.awake - base, targets.destroy - base });
    const awake_bytes: *const [awake_reloc]u8 = @ptrFromInt(targets.awake);
    const destroy_bytes: *const [destroy_prologue.len]u8 = @ptrFromInt(targets.destroy);
    if (!awakeMatches(awake_bytes) or !std.mem.eql(u8, destroy_bytes, &destroy_prologue)) {
        log.err("battle hooks: prologue mismatch (awake {x}, destroy {x}) -- per-battle folders off, everything stays in the diagnostics lobby folder", .{ awake_bytes[0..awake_reloc], destroy_bytes });
        return;
    }
    var syscall: nt.Syscall = .init;
    installAwake(&syscall, targets.awake) catch |err| {
        log.err("battle awake hook failed: {t}", .{err});
        return;
    };
    installDestroy(&syscall, targets.destroy) catch |err| {
        log.err("battle destroy hook failed: {t} (awake hook is live; folders still rotate)", .{err});
        return;
    };
    log.info("battle hooks installed; per-battle folders under {s}", .{session_dir[0..session_len]});
}

