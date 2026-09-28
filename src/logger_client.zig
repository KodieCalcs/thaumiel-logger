//! The one switch that decides whether the combat logger runs at all.
//!
//! Every logger hook is pinned to a single client build. The client patch itself (upstream
//! thaumiel: login redirect, keys, offsets.zon) is updated separately and often sooner. This
//! check lets a build that carries a newer upstream patch but an older logger run safely: when
//! the game's GameAssembly.dll is not the build the logger was made for, dynlib.zig starts no
//! logger module at all and the game runs exactly as it would under upstream thaumiel.
//!
//! The per-module guards (eventlog.zig, damage_probe.c, the dumper's table check, the prologue
//! compares) stay in place as a second line; this gate means none of them is reached on an
//! unsupported client.
//!
//! When the logger is moved to a new client (docs/client-update-playbook.md), update the three
//! values below together with the per-module pins.
const std = @import("std");
const w = std.os.windows;
const build_options = @import("build_options");

/// The client build every logger pin in this tree targets.
pub const client_name = "CNBetaWin3.3.4";
pub const client_timestamp: u32 = 0x6AB435F6;
pub const client_size_of_image: u32 = 0x21714000;

const names = @import("capture_names.zig");

extern "kernel32" fn GetModuleHandleA(?[*:0]const u8) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn CreateFileA([*:0]const u8, u32, u32, ?*anyopaque, u32, u32, ?w.HANDLE) callconv(.winapi) w.HANDLE;
extern "kernel32" fn WriteFile(w.HANDLE, [*]const u8, u32, *u32, ?*anyopaque) callconv(.winapi) w.BOOL;
extern "kernel32" fn CloseHandle(w.HANDLE) callconv(.winapi) w.BOOL;
extern "kernel32" fn CreateDirectoryA([*:0]const u8, ?*anyopaque) callconv(.winapi) w.BOOL;
extern "kernel32" fn GetFileAttributesA([*:0]const u8) callconv(.winapi) u32;
extern "kernel32" fn SearchPathA(?[*:0]const u8, [*:0]const u8, ?[*:0]const u8, u32, ?[*]u8, ?*?[*]u8) callconv(.winapi) u32;

pub const Identity = struct { timestamp: u32, size_of_image: u32 };

pub fn matches(id: Identity) bool {
    return id.timestamp == client_timestamp and id.size_of_image == client_size_of_image;
}

fn readIdentity() ?Identity {
    const module = GetModuleHandleA("GameAssembly.dll") orelse return null;
    const base = @intFromPtr(module);
    const e_lfanew = std.mem.readInt(u32, @as(*const [4]u8, @ptrFromInt(base + 0x3c)), .little);
    return .{
        .timestamp = std.mem.readInt(u32, @as(*const [4]u8, @ptrFromInt(base + e_lfanew + 8)), .little),
        .size_of_image = std.mem.readInt(u32, @as(*const [4]u8, @ptrFromInt(base + e_lfanew + 0x50)), .little),
    };
}

/// Whether each battle will get its combat-log.xlsx and combat-log.json (capture.zig starts the
/// summarizer when a battle ends).
pub const Summaries = enum { on, no_tools, no_node };

fn summariesState() Summaries {
    const missing: u32 = 0xFFFFFFFF;
    if (GetFileAttributesA(names.tools_dir ++ "\\summarize.mjs") == missing) return .no_tools;
    if (GetFileAttributesA(names.tools_dir ++ "\\node\\node.exe") != missing) return .on;
    if (SearchPathA(null, "node.exe", null, 0, null, null) != 0) return .on;
    return .no_node;
}

/// `logger-disable.txt` beside the launcher turns the whole logger off, for comparing the game
/// with and without it on the same DLL (the client patch runs either way).
pub const disable_file = "logger-disable.txt";

const disabled_text =
    \\Combat logger: OFF
    \\
    \\Turned off by logger-disable.txt next to remielle.exe. The game itself works normally.
    \\Delete that file to turn the logger back on.
    \\
;

/// True when the running client is the one the logger was built for and the logger is not
/// turned off. Always writes `Combat Logs\logger status.txt` explaining the outcome in plain words.
pub fn supported() bool {
    if (GetFileAttributesA(disable_file) != 0xFFFFFFFF) {
        _ = CreateDirectoryA(names.root_dir, null);
        writeStatus(disabled_text);
        return false;
    }
    const id = readIdentity();
    const ok = if (id) |i| matches(i) else false;
    var buffer: [4096]u8 = undefined;
    const text = statusText(&buffer, ok, id, if (ok) summariesState() else .on) catch return ok;
    _ = CreateDirectoryA(names.root_dir, null);
    writeStatus(text);
    return ok;
}

pub fn statusText(buffer: []u8, ok: bool, id: ?Identity, summaries: Summaries) ![]const u8 {
    const found = id orelse Identity{ .timestamp = 0, .size_of_image = 0 };
    if (ok) {
        const summaries_line = switch (summaries) {
            .on => "ON",
            .no_tools => "OFF - the logger's tools are missing from Combat Logs\\.tools.\n  Install again (install.cmd, or copy the release zip in again).",
            .no_node => "OFF - Node.js was not found.\n  Install again (install.cmd, or copy the release zip in again), which includes it.",
        };
        return std.fmt.bufPrint(buffer,
            \\Combat logger: ON
            \\Game version: {s} (supported)
            \\Summaries: {s}
            \\
            \\Your battles are saved in this folder, one folder per day:
            \\  2026-09-28\Battle 7\
            \\Only battles the server settles get a folder, named after the settlement
            \\file it writes (endbattle_7.pb -> Battle 7). Retried or quit battles are skipped.
            \\
            \\A few seconds after a battle ends, its folder gets two files:
            \\  combat-log.xlsx  damage and Daze per character and skill, and every hit
            \\                   (opens in Excel / Google Sheets)
            \\  combat-log.json  every hit, for programs and AI tools
            \\Those are the files to share. The raw data next to them is hidden;
            \\it can contain account details, so don't share whole folders.
            \\
        , .{ client_name, summaries_line });
    }
    return std.fmt.bufPrint(buffer,
        \\Combat logger: OFF
        \\
        \\This game version is not the one this logger was made for ({s}),
        \\so the logger switched itself off. The game itself works normally.
        \\
        \\To get the logger back once it is updated for this game version:
        \\  - installed from the source code: run "git pull", then install.cmd
        \\  - installed from a download: get the newest one from
        \\      {s}
        \\
        \\(details for bug reports: GameAssembly timestamp 0x{X}, size 0x{X};
        \\ expected 0x{X}, size 0x{X})
        \\
    , .{ client_name, build_options.releases_url, found.timestamp, found.size_of_image, client_timestamp, client_size_of_image });
}

fn writeStatus(text: []const u8) void {
    // GENERIC_WRITE, share read, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL.
    const handle = CreateFileA(names.status_file, 0x40000000, 1, null, 2, 0x80, null);
    if (handle == w.INVALID_HANDLE_VALUE) return;
    defer _ = CloseHandle(handle);
    // Notepad-friendly line endings.
    var line_start: usize = 0;
    var written: u32 = 0;
    for (text, 0..) |c, i| {
        if (c != '\n') continue;
        _ = WriteFile(handle, text[line_start..i].ptr, @intCast(i - line_start), &written, null);
        _ = WriteFile(handle, "\r\n", 2, &written, null);
        line_start = i + 1;
    }
    if (line_start < text.len) _ = WriteFile(handle, text[line_start..].ptr, @intCast(text.len - line_start), &written, null);
}

test "only the pinned client build is supported" {
    try std.testing.expect(matches(.{ .timestamp = client_timestamp, .size_of_image = client_size_of_image }));
    try std.testing.expect(!matches(.{ .timestamp = client_timestamp, .size_of_image = client_size_of_image + 0x1000 }));
    try std.testing.expect(!matches(.{ .timestamp = client_timestamp + 1, .size_of_image = client_size_of_image }));
    try std.testing.expect(!matches(.{ .timestamp = 0, .size_of_image = 0 }));
}

test "status text names the outcome and, when off, where to get an update" {
    var buffer: [4096]u8 = undefined;
    const on = try statusText(&buffer, true, .{ .timestamp = client_timestamp, .size_of_image = client_size_of_image }, .on);
    try std.testing.expect(std.mem.startsWith(u8, on, "Combat logger: ON"));
    try std.testing.expect(std.mem.indexOf(u8, on, "Summaries: ON") != null);
    var buffer2: [4096]u8 = undefined;
    const no_node = try statusText(&buffer2, true, .{ .timestamp = client_timestamp, .size_of_image = client_size_of_image }, .no_node);
    try std.testing.expect(std.mem.indexOf(u8, no_node, "Node.js was not found") != null);
    var buffer3: [4096]u8 = undefined;
    const off = try statusText(&buffer3, false, .{ .timestamp = 0x12345678, .size_of_image = 0x1000 }, .on);
    try std.testing.expect(std.mem.startsWith(u8, off, "Combat logger: OFF"));
    try std.testing.expect(std.mem.indexOf(u8, off, build_options.releases_url) != null);
    try std.testing.expect(std.mem.indexOf(u8, off, "git pull") != null);
    try std.testing.expect(std.mem.indexOf(u8, off, "0x12345678") != null);
}
