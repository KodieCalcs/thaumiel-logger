//! Capture folder and file names (capture.zig). Kept apart from capture.zig so the names can be
//! tested without linking the hooks.
//!
//!   Combat Logs\                              root_dir, beside remielle.exe
//!     logger status.txt                       logger_client.zig
//!     2026-09-28\                             one folder per day
//!       Battle 3 - 14.05\                     battles numbered through the day
//!         combat-log.csv, summary.json        the summarizer's output; raw logs are hidden
//!     .diagnostics\2026-09-28 14.03.26\       hidden: per-launch logs, probe status, dump, lobby\
//!     .tools\                                 hidden: summarize.mjs, the readers, node\node.exe
const std = @import("std");

pub const root_dir = "Combat Logs";
pub const diagnostics_dir = root_dir ++ "\\.diagnostics";
pub const tools_dir = root_dir ++ "\\.tools";
pub const status_file = root_dir ++ "\\logger status.txt";
/// The two files a player reads; everything else in a battle folder is hidden.
pub const visible_outputs = [_][]const u8{ "combat-log.csv", "summary.json" };

/// kernel32 SYSTEMTIME, as filled by GetLocalTime.
pub const SystemTime = extern struct { year: u16, month: u16, day_of_week: u16, day: u16, hour: u16, minute: u16, second: u16, ms: u16 };

/// The day folder a battle starting at `now` goes in.
pub fn dayFolderName(buf: []u8, now: SystemTime) []const u8 {
    return std.fmt.bufPrint(buf, "{d:0>4}-{d:0>2}-{d:0>2}", .{ now.year, now.month, now.day }) catch unreachable;
}

/// Battle `n` of its day, started at `now`.
pub fn battleFolderName(buf: []u8, n: u32, now: SystemTime) []const u8 {
    return std.fmt.bufPrint(buf, "Battle {d} - {d:0>2}.{d:0>2}", .{ n, now.hour, now.minute }) catch unreachable;
}

/// The number in a "Battle <n> - ..." folder name, or null for anything else.
pub fn battleNumber(name: []const u8) ?u32 {
    const prefix = "Battle ";
    if (!std.mem.startsWith(u8, name, prefix)) return null;
    const rest = name[prefix.len..];
    const end = std.mem.indexOfNone(u8, rest, "0123456789") orelse rest.len;
    if (end == 0) return null;
    return std.fmt.parseInt(u32, rest[0..end], 10) catch null;
}

/// The per-launch diagnostics folder for a launch at `now`; `attempt > 1` adds " (attempt)".
pub fn launchFolderName(buf: []u8, now: SystemTime, attempt: u32) []const u8 {
    const stamp = "{d:0>4}-{d:0>2}-{d:0>2} {d:0>2}.{d:0>2}.{d:0>2}";
    const t = .{ now.year, now.month, now.day, now.hour, now.minute, now.second };
    if (attempt <= 1) return std.fmt.bufPrint(buf, stamp, t) catch unreachable;
    return std.fmt.bufPrint(buf, stamp ++ " ({d})", t ++ .{attempt}) catch unreachable;
}

pub fn isVisibleOutput(file_name: []const u8) bool {
    for (visible_outputs) |name| if (std.ascii.eqlIgnoreCase(name, file_name)) return true;
    return false;
}

test "folder names read as a day, a battle number and a time" {
    const at: SystemTime = .{ .year = 2026, .month = 9, .day_of_week = 1, .day = 8, .hour = 4, .minute = 5, .second = 6, .ms = 0 };
    var buf: [64]u8 = undefined;
    try std.testing.expectEqualStrings("2026-09-08", dayFolderName(&buf, at));
    try std.testing.expectEqualStrings("Battle 12 - 04.05", battleFolderName(&buf, 12, at));
    try std.testing.expectEqualStrings("2026-09-08 04.05.06", launchFolderName(&buf, at, 1));
    try std.testing.expectEqualStrings("2026-09-08 04.05.06 (2)", launchFolderName(&buf, at, 2));
}

test "battle numbers are read back from folder names, and nothing else is" {
    try std.testing.expectEqual(@as(?u32, 12), battleNumber("Battle 12 - 04.05"));
    try std.testing.expectEqual(@as(?u32, 3), battleNumber("Battle 3"));
    try std.testing.expectEqual(@as(?u32, null), battleNumber("Battle - 04.05"));
    try std.testing.expectEqual(@as(?u32, null), battleNumber("battle-3"));
    try std.testing.expectEqual(@as(?u32, null), battleNumber(".diagnostics"));
}

test "only the two summary files stay visible" {
    try std.testing.expect(isVisibleOutput("combat-log.csv"));
    try std.testing.expect(isVisibleOutput("summary.json"));
    try std.testing.expect(!isVisibleOutput("hits.tsv"));
    try std.testing.expect(!isVisibleOutput("per-hit-log.csv"));
}
