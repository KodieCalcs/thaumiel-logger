//! Human-readable capture folder names (capture.zig). Kept apart from capture.zig so the names
//! can be tested without linking the hooks.
const std = @import("std");

/// kernel32 SYSTEMTIME, as filled by GetLocalTime.
pub const SystemTime = extern struct { year: u16, month: u16, day_of_week: u16, day: u16, hour: u16, minute: u16, second: u16, ms: u16 };

/// Folder name for battle `n` that started at local time `now`; `n == 0` is the time between
/// launch and the first battle (menus, lobby).
pub fn battleFolderName(buf: []u8, n: u32, now: SystemTime) []const u8 {
    if (n == 0) return std.fmt.bufPrint(buf, "Before first battle", .{}) catch unreachable;
    return std.fmt.bufPrint(buf, "Battle {d} - {d:0>2}.{d:0>2}.{d:0>2}", .{ n, now.hour, now.minute, now.second }) catch unreachable;
}

/// Folder name for a game launch at local time `now`; `attempt > 1` adds " (attempt)".
pub fn launchFolderName(buf: []u8, now: SystemTime, attempt: u32) []const u8 {
    const stamp = "{d:0>4}-{d:0>2}-{d:0>2} {d:0>2}.{d:0>2}.{d:0>2}";
    const t = .{ now.year, now.month, now.day, now.hour, now.minute, now.second };
    if (attempt <= 1) return std.fmt.bufPrint(buf, stamp, t) catch unreachable;
    return std.fmt.bufPrint(buf, stamp ++ " ({d})", t ++ .{attempt}) catch unreachable;
}

test "folder names read as a date, a battle number and a time" {
    const at: SystemTime = .{ .year = 2026, .month = 9, .day_of_week = 1, .day = 8, .hour = 4, .minute = 5, .second = 6, .ms = 0 };
    var buf: [64]u8 = undefined;
    try std.testing.expectEqualStrings("2026-09-08 04.05.06", launchFolderName(&buf, at, 1));
    try std.testing.expectEqualStrings("2026-09-08 04.05.06 (2)", launchFolderName(&buf, at, 2));
    try std.testing.expectEqualStrings("Before first battle", battleFolderName(&buf, 0, at));
    try std.testing.expectEqualStrings("Battle 12 - 04.05.06", battleFolderName(&buf, 12, at));
}
