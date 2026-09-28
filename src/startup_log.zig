//! Persist bootstrap/hit-hook messages even when the optional metadata dump is disabled.
//! Open before starting worker threads; each message uses its own stack buffer and one
//! synchronous append write, avoiding shared formatter state across game/worker threads.
const std = @import("std");
const w = std.os.windows;
const capture = @import("capture.zig");
extern "kernel32" fn CreateFileA([*:0]const u8, u32, u32, ?*anyopaque, u32, u32, ?w.HANDLE) callconv(.winapi) w.HANDLE;
extern "kernel32" fn WriteFile(w.HANDLE, [*]const u8, u32, *u32, ?*anyopaque) callconv(.winapi) w.BOOL;
extern "kernel32" fn GetTickCount64() callconv(.winapi) u64;
extern "kernel32" fn GetCurrentProcessId() callconv(.winapi) u32;
var output: ?w.HANDLE = null;
var started: u64 = 0;

pub fn start() void {
    var path: capture.PathBuf = undefined;
    const handle = CreateFileA(capture.sessionPath(&path, "hitlog-startup.log"), 0x4, 1, null, 2, 0x80, null);
    if (handle == w.INVALID_HANDLE_VALUE) return;
    output = handle;
    started = GetTickCount64();
    note(.info, .hitlog, "startup diagnostics pid {d}", .{GetCurrentProcessId()});
}

pub fn note(comptime level: std.log.Level, comptime scope: @EnumLiteral(), comptime format: []const u8, args: anytype) void {
    const handle = output orelse return;
    var message_buffer: [4096]u8 = undefined;
    const message = std.fmt.bufPrint(&message_buffer, format, args) catch return;
    var line_buffer: [4352]u8 = undefined;
    const line = std.fmt.bufPrint(&line_buffer, "{d}ms {s}({s}): {s}\r\n", .{
        GetTickCount64() - started, @tagName(level), @tagName(scope), message,
    }) catch return;
    var written: u32 = 0;
    _ = WriteFile(handle, line.ptr, @intCast(line.len), &written, null);
}

extern "kernel32" fn ReadFile(w.HANDLE, [*]u8, u32, *u32, ?*anyopaque) callconv(.winapi) w.BOOL;
extern "kernel32" fn CloseHandle(w.HANDLE) callconv(.winapi) w.BOOL;

test "startup messages persist without the optional dumper or console" {
    note(.info, .hitlog, "before opening is a no-op", .{});
    start();
    try std.testing.expect(output != null);
    defer {
        _ = CloseHandle(output.?);
        output = null;
    }
    note(.err, .dumper, "readiness test failure {d}", .{42});
    note(.info, .hitlog, "hook test installed", .{});
    const reader = CreateFileA("hitlog-startup.log", 0x80000000, 3, null, 3, 0x80, null);
    try std.testing.expect(reader != w.INVALID_HANDLE_VALUE);
    defer _ = CloseHandle(reader);
    var bytes: [8192]u8 = undefined;
    var count: u32 = 0;
    try std.testing.expect(ReadFile(reader, &bytes, bytes.len, &count, null) != .FALSE);
    const text = bytes[0..count];
    try std.testing.expect(std.mem.indexOf(u8, text, "startup diagnostics pid") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "err(dumper): readiness test failure 42") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "info(hitlog): hook test installed") != null);
}
