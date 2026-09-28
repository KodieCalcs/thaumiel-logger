//! Sampling profiler: find the combat code by watching what actually executes.
//!
//! Static analysis is exhausted (see docs/reference/il2cpp-runtime-dump-attempt.md):
//! the runtime combat classes are obfuscated, `.pdata` is mangled, and field
//! offsets do not identify a type. But we are already inside the process, so we
//! can just look at where the CPU is.
//!
//! Every few milliseconds this suspends each game thread, reads RIP, resumes,
//! and records the offset into GameAssembly.dll. Sample while idle, then sample
//! while attacking; whatever only appears in the second set is the damage path.
//!
//! Output: sampler.csv in the game directory -- `elapsed_ms,thread_id,rva`.
//! Map RVAs to methods offline against the v6/v7 dump TSV.
//!
//! Deliberately does no allocation, no locking and no I/O while a thread is
//! held suspended; that is what makes this safe to do to a running game.

const std = @import("std");
const w = std.os.windows;

const log = std.log.scoped(.sampler);

// --- bindings ----------------------------------------------------------------

const THREADENTRY32 = extern struct {
    dwSize: u32,
    cntUsage: u32,
    th32ThreadID: u32,
    th32OwnerProcessID: u32,
    tpBasePri: i32,
    tpDeltaPri: i32,
    dwFlags: u32,
};

extern "kernel32" fn GetModuleHandleA(?[*:0]const u8) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn Sleep(u32) callconv(.winapi) void;
extern "kernel32" fn GetCurrentProcessId() callconv(.winapi) u32;
extern "kernel32" fn GetCurrentThreadId() callconv(.winapi) u32;
extern "kernel32" fn GetTickCount64() callconv(.winapi) u64;
extern "kernel32" fn CreateToolhelp32Snapshot(u32, u32) callconv(.winapi) w.HANDLE;
extern "kernel32" fn Thread32First(w.HANDLE, *THREADENTRY32) callconv(.winapi) w.BOOL;
extern "kernel32" fn Thread32Next(w.HANDLE, *THREADENTRY32) callconv(.winapi) w.BOOL;
extern "kernel32" fn OpenThread(u32, w.BOOL, u32) callconv(.winapi) ?w.HANDLE;
extern "kernel32" fn SuspendThread(w.HANDLE) callconv(.winapi) u32;
extern "kernel32" fn ResumeThread(w.HANDLE) callconv(.winapi) u32;
extern "kernel32" fn GetThreadContext(w.HANDLE, *w.CONTEXT) callconv(.winapi) w.BOOL;
extern "kernel32" fn CloseHandle(w.HANDLE) callconv(.winapi) w.BOOL;
extern "kernel32" fn CreateFileA([*:0]const u8, u32, u32, ?*anyopaque, u32, u32, ?w.HANDLE) callconv(.winapi) w.HANDLE;
extern "kernel32" fn WriteFile(w.HANDLE, [*]const u8, u32, *u32, ?*anyopaque) callconv(.winapi) w.BOOL;
extern "kernel32" fn FlushFileBuffers(w.HANDLE) callconv(.winapi) w.BOOL;
extern "kernel32" fn CreateThread(?*anyopaque, usize, *const fn (?*anyopaque) callconv(.winapi) u32, ?*anyopaque, u32, ?*u32) callconv(.winapi) ?w.HANDLE;

const TH32CS_SNAPTHREAD: u32 = 0x4;
const THREAD_SUSPEND_RESUME: u32 = 0x0002;
const THREAD_GET_CONTEXT: u32 = 0x0008;
const CONTEXT_CONTROL_AMD64: u32 = 0x00100001;

// --- tuning ------------------------------------------------------------------

const settle_ms: u32 = 30_000; // let the client reach the title screen
const period_ms: u32 = 5; // ~200 Hz
const refresh_threads_every: u32 = 400; // re-enumerate threads every ~2 s
const run_for_ms: u64 = 10 * 60 * 1000; // stop after 10 minutes
const max_threads = 128;

// --- output ------------------------------------------------------------------

var out: w.HANDLE = undefined;
var buf: [64 << 10]u8 = undefined;
var len: usize = 0;

fn flush() void {
    if (len == 0) return;
    var written: u32 = 0;
    _ = WriteFile(out, &buf, @intCast(len), &written, null);
    _ = FlushFileBuffers(out);
    len = 0;
}

fn emit(comptime fmt: []const u8, args: anytype) void {
    if (len + 128 > buf.len) flush();
    const s = std.fmt.bufPrint(buf[len..], fmt, args) catch return;
    len += s.len;
}

// --- sampling ----------------------------------------------------------------

var game: usize = 0;
var game_size: usize = 0;
var self_tid: u32 = 0;

fn collectThreads(list: *[max_threads]u32) usize {
    const snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (snap == w.INVALID_HANDLE_VALUE) return 0;
    defer _ = CloseHandle(snap);

    const pid = GetCurrentProcessId();
    var entry: THREADENTRY32 = undefined;
    entry.dwSize = @sizeOf(THREADENTRY32);
    var n: usize = 0;

    if (Thread32First(snap, &entry) == .FALSE) return 0;
    while (true) {
        if (entry.th32OwnerProcessID == pid and entry.th32ThreadID != self_tid) {
            if (n < max_threads) {
                list[n] = entry.th32ThreadID;
                n += 1;
            }
        }
        entry.dwSize = @sizeOf(THREADENTRY32);
        if (Thread32Next(snap, &entry) == .FALSE) break;
    }
    return n;
}

/// Suspends one thread just long enough to read RIP. Nothing that can block or
/// allocate happens between suspend and resume.
fn sampleThread(tid: u32) ?usize {
    const h = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT, .FALSE, tid) orelse return null;
    defer _ = CloseHandle(h);

    if (SuspendThread(h) == std.math.maxInt(u32)) return null;

    var ctx: w.CONTEXT align(16) = std.mem.zeroes(w.CONTEXT);
    ctx.ContextFlags = CONTEXT_CONTROL_AMD64;
    const ok = GetThreadContext(h, &ctx) != .FALSE;

    _ = ResumeThread(h);

    if (!ok) return null;
    return @intCast(ctx.Rip);
}

fn threadMain(_: ?*anyopaque) callconv(.winapi) u32 {
    self_tid = GetCurrentThreadId();
    log.info("sampler: settling for {d}s", .{settle_ms / 1000});
    Sleep(settle_ms);

    const module = GetModuleHandleA("GameAssembly.dll") orelse {
        log.err("GameAssembly.dll not loaded", .{});
        return 1;
    };
    game = @intFromPtr(module);
    const base: [*]const u8 = @ptrCast(module);
    const pe = std.mem.readInt(u32, (base + 0x3c)[0..4], .little);
    game_size = std.mem.readInt(u32, (base + pe + 0x18 + 0x38)[0..4], .little);

    out = CreateFileA("sampler.csv", 0x40000000, 1, null, 2, 0x80, null);
    if (out == w.INVALID_HANDLE_VALUE) {
        log.err("could not create sampler.csv", .{});
        return 1;
    }
    defer {
        flush();
        _ = CloseHandle(out);
    }

    emit("# GameAssembly base=0x{X} size=0x{X}\n", .{ game, game_size });
    emit("elapsed_ms,thread_id,rva\n", .{});
    log.info("sampler: recording to sampler.csv (base 0x{X})", .{game});
    log.info("sampler: idle for ~60s, THEN go fight something", .{});

    var threads: [max_threads]u32 = undefined;
    var count = collectThreads(&threads);
    var ticks: u32 = 0;
    var samples: u64 = 0;
    const started = GetTickCount64();

    while (GetTickCount64() - started < run_for_ms) {
        if (ticks % refresh_threads_every == 0) count = collectThreads(&threads);
        ticks += 1;

        const elapsed = GetTickCount64() - started;
        for (threads[0..count]) |tid| {
            const rip = sampleThread(tid) orelse continue;
            if (rip < game or rip >= game + game_size) continue;
            emit("{d},{d},0x{X}\n", .{ elapsed, tid, rip - game });
            samples += 1;
        }

        if (ticks % 200 == 0) {
            flush();
            if (ticks % 4000 == 0)
                log.info("sampler: {d}s, {d} in-module samples", .{ elapsed / 1000, samples });
        }

        Sleep(period_ms);
    }

    flush();
    log.info("sampler: finished, {d} samples", .{samples});
    return 0;
}

pub fn start() void {
    _ = CreateThread(null, 0, threadMain, null, 0, null);
}
