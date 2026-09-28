// Modified from upstream thaumiel (0e669bc) for the per-hit logger fork, 2026-09-11..13: wires the
// il2cpp dumper, hit log and damage probes into initPatches(). See README.md (AGPL-3.0 §5a).
const std = @import("std");
const mem = std.mem;

const common = @import("common.zig");
const die = common.die;

const GameAssembly = @import("GameAssembly.zig");
const String = GameAssembly.String;

const nt = @import("nt.zig");
const debugging = @import("debugging.zig");
const dumper = @import("dumper.zig");
const sampler = @import("sampler.zig");
const hitlog = @import("hitlog.zig");
const eventlog = @import("eventlog.zig");
const timescalelog = @import("timescalelog.zig");
const statelog = @import("statelog.zig");
const capture = @import("capture.zig");
const logger_client = @import("logger_client.zig");
extern fn damage_probe_start() callconv(.c) c_int;
extern fn damage_numeric_start() callconv(.c) c_int;
extern fn damage_event_start() callconv(.c) c_int;
extern fn damage_enqueue_start() callconv(.c) c_int;
extern fn damage_result_start() callconv(.c) c_int;
extern fn damage_snapshot_start() callconv(.c) c_int;
extern fn damage_daze_start() callconv(.c) c_int;
extern fn damage_anomaly_start() callconv(.c) c_int;
extern fn damage_probe_note_status(name: [*:0]const u8, status: c_int) callconv(.c) void;
const Interception = @import("Interception.zig");

pub const std_options: std.Options = .{
    .logFn = debugging.logFn,
    .log_level = .info,
};

const log = std.log.scoped(.thaumiel);

var game_assembly: GameAssembly = undefined; // populated by `hookLoadMhyBase`

pub export fn DllMain(
    _: std.os.windows.HINSTANCE,
    reason: std.os.windows.DWORD,
    _: std.os.windows.LPVOID,
) callconv(.winapi) std.os.windows.BOOL {
    if (reason == 1) {
        debugging.init();

        var syscall: nt.Syscall = .init;
        hookIsLoadMhyBase(&syscall) catch |err| die(
            "failed to hook `IsLoadMHYBase`: {t} (NTSTATUS: 0x{X})",
            .{ err, @intFromEnum(syscall.status) },
        );
    }

    return .TRUE;
}

fn hookIsLoadMhyBase(syscall: *nt.Syscall) !void {
    game_assembly = try .load(syscall);
    try nt.unhookNtdll(syscall);
    _ = try Interception.replace(syscall, game_assembly.add(.IsLoadMHYBase), isLoadMhyBaseReplacement);
}

fn isLoadMhyBaseReplacement() callconv(.c) bool {
    var syscall: nt.Syscall = .init;
    if (initPatches(&syscall))
        return false
    else |err|
        die(
            "failed to initialize patches: {t} (NTSTATUS: 0x{X})",
            .{ err, @intFromEnum(syscall.status) },
        );
}

var set_login_setting_by_json: Interception = undefined;
const sdk_public_key = @embedFile("sdk_public_key.xml");

fn initPatches(syscall: *nt.Syscall) !void {
    try nt.unhookNtdll(syscall);
    set_login_setting_by_json = try .replace(
        syscall,
        game_assembly.add(.@"Foundation.Assets::SetLoginSettingByJson"),
        setLoginSettingByJsonReplacement,
    );
    _ = try Interception.replace(
        syscall,
        game_assembly.add(.@"MiHoYo.SDK.SDKDelegate.LoadFileDelegate::Invoke"),
        loadFileDelegateInvokeReplacement,
    );
    _ = try Interception.replace(
        syscall,
        game_assembly.add(.@"MiHoYo.SDK.DeviceFPManager::GetDeviceFP"),
        getDeviceFpReplacement,
    );
    for (game_assembly.addMany(.sdk_rsa_keys)) |rsa_key|
        @as(**const String, @ptrFromInt(rsa_key)).* = .allocZ(game_assembly, sdk_public_key);
    var d: [39]u16 = @splat(0);
    for ([_]u16{ 27818, 40348, 47410, 27936, 51394, 33172, 51987, 8709, 44748, 23705, 45753, 21092, 57054, 52661, 369, 62630, 11725, 7496, 36921, 28271, 34880, 52645, 31515, 18214, 3108, 2077, 13490, 25459, 58590, 47504, 15163, 8951, 44748, 23705, 45753, 29284, 57054, 52661 }, 0..d.len - 1) |v, i| {
        const b: i16 = @bitCast(@as(u16, @truncate(@subWithOverflow(((i + ((i >> 31) >> 29)) & 0xF8), i).@"0")));
        d[i] = @byteSwap(v >> @as(u4, @intCast(@mod(-11 - b, 16))) | v << @as(u4, @intCast(@mod(b + 11, 16))));
    }
    @as(**const String, @ptrFromInt(game_assembly.add(.crypto_str))).* = .allocZ(game_assembly, @ptrCast(&d));
    ensureRsaKey();

    for (game_assembly.addMany(.dither_alpha_strings)) |dither_alpha_string|
        @as(**String, @ptrFromInt(dither_alpha_string)).* = .allocZ(game_assembly, "InvalidProperty");

    try nt.writeExecutable(
        syscall,
        game_assembly.add(.@"MoleMole.UIMainCityMiniMenuWidgetController::RefreshGachaTimeIcon"),
        &.{0xC3},
    );

    // Everything above is upstream thaumiel's client patch; everything below is the combat
    // logger. On a client the logger was not built for, start none of it (logger_client.zig), so
    // a build that follows a newer upstream runs exactly like upstream.
    if (!logger_client.supported()) {
        log.info("combat logger off: this client is not {s}", .{logger_client.client_name});
        return;
    }

    // Sampling profiler: superseded by the hit hook below, kept for profiling
    // questions. Re-enable if needed; it costs ~30 thread suspends/second.
    if (false) sampler.start();

    // Capture folder: Combat Logs\<launch>\Battle <n> - <time>\ for everything below (capture.zig).
    capture.start();
    // Per-hit log: hooks ConfigEntityAnimEvent::TriggerAttackPattern.
    @import("startup_log.zig").start();
    hitlog.start(syscall);
    // Open hit output before publishing it to the worker. A ready runtime must
    // never let installFromWorker observe an unopened file and silently return.
    dumper.start();
    // Animator-event log: hooks the anim-event system's per-frame queue drain (all event types).
    eventlog.start(syscall);
    // Global time-scale log: hooks the level time manager's per-frame step (timescalelog.zig).
    timescalelog.start();
    // Buff / property / Stun state log: hooks the property write, modifier lifecycle and stun
    // mixin (statelog.zig). Opens the file here; the hooks install from the dumper's worker.
    statelog.start();
    const damage_status = damage_probe_start();
    damage_probe_note_status("string", damage_status);
    log.info("damage probe status {d} (0 disabled, 1 installed, 2 installed/protection warning, negative refused)", .{damage_status});
    const numeric_status = if (damage_status == 1) damage_numeric_start() else @as(c_int, 0);
    damage_probe_note_status("numeric", numeric_status);
    log.info("damage numeric probe status {d} (1 installed; requires string probe status 1)", .{numeric_status});
    // Damage-display event handler: the struct the combat engine hands the UI, one per number.
    const event_status = if (damage_status == 1) damage_event_start() else @as(c_int, 0);
    damage_probe_note_status("event", event_status);
    log.info("damage event probe status {d} (1 installed; requires string probe status 1)", .{event_status});
    // Enqueue side of the same event: fires at hit time on the combat stack; its caller is the publisher.
    const enqueue_status = if (damage_status == 1) damage_enqueue_start() else @as(c_int, 0);
    damage_probe_note_status("enqueue", enqueue_status);
    const result_status = if (damage_status == 1) damage_result_start() else @as(c_int, 0);
    damage_probe_note_status("result", result_status);
    log.info("damage result probe status {d}", .{result_status});
    // Hit-result factory: the attacker snapshot object the result is built from (not reachable from the result).
    const snapshot_status = if (damage_status == 1) damage_snapshot_start() else @as(c_int, 0);
    damage_probe_note_status("snapshot", snapshot_status);
    log.info("damage snapshot probe status {d}", .{snapshot_status});
    // Stun component be-hit handler: the target's Daze gauge before each hit (applied Daze is result+0x18c).
    const daze_status = if (damage_status == 1) damage_daze_start() else @as(c_int, 0);
    damage_probe_note_status("daze", daze_status);
    log.info("damage daze probe status {d}", .{daze_status});
    // Per-element anomaly gauge receive: the target's Anomaly Buildup gauge before each hit (requested/applied are result+0xf8/+0x150).
    const anomaly_status = if (damage_status == 1) damage_anomaly_start() else @as(c_int, 0);
    damage_probe_note_status("anomaly", anomaly_status);
    log.info("damage anomaly probe status {d}", .{anomaly_status});
    log.info("damage enqueue probe status {d} (1 installed; requires string probe status 1)", .{enqueue_status});
}

const server_public_key: [:0]const u8 = @embedFile("server_public_key.xml");

fn ensureRsaKey() void {
    const rsaCreate: *const fn () callconv(.c) *anyopaque =
        @ptrFromInt(game_assembly.add(.@"System.Security.Cryptography.RSA::Create"));
    const rsaFromXmlString: *const fn (*anyopaque, *const String) callconv(.c) void =
        @ptrFromInt(game_assembly.add(.@"System.Security.Cryptography.RSA::FromXmlString"));
    const rsa = rsaCreate();
    rsaFromXmlString(rsa, .allocZ(game_assembly, server_public_key.ptr));
    game_assembly.setServerPublicKey(rsa);
}

const login_setting: [:0]const u8 = @embedFile("login_setting.json");

fn setLoginSettingByJsonReplacement(_: *String) callconv(.c) void {
    var syscall: nt.Syscall = .init;
    set_login_setting_by_json.revert(&syscall) catch die(
        "failed to revert SetLoginSettingByJson hook (NTSTATUS: 0x{X})",
        .{@intFromEnum(syscall.status)},
    );
    game_assembly.setLoginSettingByJson(login_setting);
    nt.writeExecutable(
        &syscall,
        game_assembly.add(.@"Foundation.Assets::SetLoginSettingByJson"),
        &.{0xC3},
    ) catch die(
        "failed to nuke SetLoginSettingByJson (NTSTATUS: 0x{X})",
        .{@intFromEnum(syscall.status)},
    );
}

const server_pc: [:0]const u8 = @embedFile("server_pc.json");

fn loadFileDelegateInvokeReplacement(_: *anyopaque, path: *String) callconv(.c) *String {
    log.info("LoadFileDelegate::Invoke(\"{f}\")", .{std.unicode.fmtUtf16Le(path.slice())});
    return if (mem.eql(
        u16,
        path.slice(),
        std.unicode.utf8ToUtf16LeStringLiteral("Config/server_pc.json"),
    ))
        .allocZ(game_assembly, server_pc.ptr)
    else
        .allocZ(game_assembly, "");
}

fn getDeviceFpReplacement(_: *anyopaque) callconv(.c) *String {
    ensureRsaKey();
    return .allocZ(game_assembly, "Fapper");
}
