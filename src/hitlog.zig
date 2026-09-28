//! Per-hit logger, self-locating through dumper's verified il2cpp metadata API.
//! start() creates hits.tsv/header immediately, in the capture folder (capture.zig: one folder per
//! session, one per battle; rotate() moves to the next battle's folder). The dumper worker polls until il2cpp has
//! attached its game thread (Runtime::Init done, polled at 50 ms; no fixed wait), validates its
//! version-pinned bootstrap, then calls installFromWorker() BEFORE checking dumper-disable.txt
//! or opening dump files. Resolution uses a temporary
//! thread attachment and exact class/field names plus method arity. Any lookup
//! failure installs nothing; all four eight-push prologues must pass before patching.
//! PE timestamp/SizeOfImage are logged facts; old 3.3.2 values only warn on drift.
//! The API bootstrap, C probes and obfuscated eventlog targets remain pinned.
//!
//! Hooks `MoleMole.Config.ConfigEntityAnimEvent::TriggerAttackPattern`, the
//! anim-event entry point that fires an AttackProperty at a given animation
//! frame -- i.e. the moment a hit registers. See
//! docs/reference/il2cpp-runtime-dump-attempt.md for how this was found.
//!
//! Writes hits.tsv: one row per hit with a millisecond timestamp, the raw
//! register arguments, and the decoded config actually used for that hit.
//!
//! The trampoline is unusually simple at this address: the first 12 bytes are
//! eight `push` instructions (position independent, no RIP-relative operands),
//! and thaumiel's trampoline is exactly 12 bytes, so the prologue relocates
//! verbatim with no instruction-length decoding or relocation fixups.

const std = @import("std");
const w = std.os.windows;

const nt = @import("nt.zig");
const dumper = @import("dumper.zig");
const capture = @import("capture.zig");

const log = std.log.scoped(.hitlog);

// --- the target ---------------------------------------------------------------

/// Runtime-only addresses/offsets; populated completely before any hook is patched.
const Resolved = struct {
    trigger_rva: usize,
    handle_rva: usize,
    list_rva: usize,
    cont_rva: usize,
    anim_event_active_dynamic_prop: usize,
    anim_event_attack_property: usize,
    anim_event_attack_pattern_type: usize,
    anim_event_attack_effect: usize,
    prop_down_hit_effect: usize,
    prop_sky_hit_effect: usize,
    prop_ground_hit_effect: usize,
    dyn_override_key: usize,
    dyn_custom_percent: usize,
    dyn_ether_purify: usize,
    dyn_damage_ratio: usize,
    dyn_ep_recovery: usize,
    dyn_break_stun_ratio: usize,
    dyn_element_accum: usize,
    prop_damage_element: usize,
    prop_damage_hit_type: usize,
    prop_hit_type: usize,
    prop_is_cause_stun: usize,
    prop_is_heavy_attack: usize,
};
var resolved: Resolved = undefined;

/// CNBetaWin3.3.2 cross-check ONLY. Never used to locate, decode, or gate a hook.
const known_3_3_2 = struct {
    const timestamp: u32 = 0x6AA31B73;
    const size_of_image: u32 = 0x21396000;
    const values: Resolved = .{
        .trigger_rva = 0x16A012B0,
        .handle_rva = 0x16A01590,
        .list_rva = 0x16A01B30,
        .cont_rva = 0x16A02BB0,
        .anim_event_active_dynamic_prop = 0x70,
        .anim_event_attack_property = 0x30,
        .anim_event_attack_pattern_type = 0x80,
        .anim_event_attack_effect = 0x10,
        .prop_down_hit_effect = 0x110,
        .prop_sky_hit_effect = 0xC8,
        .prop_ground_hit_effect = 0x58,
        .dyn_override_key = 0x3C,
        .dyn_custom_percent = 0x50,
        .dyn_ether_purify = 0x5C,
        .dyn_damage_ratio = 0x2C,
        .dyn_ep_recovery = 0x64,
        .dyn_break_stun_ratio = 0x44,
        .dyn_element_accum = 0x48,
        .prop_damage_element = 0x174,
        .prop_damage_hit_type = 0x178,
        .prop_hit_type = 0x144,
        .prop_is_cause_stun = 0x13E,
        .prop_is_heavy_attack = 0x13D,
    };
};

/// Eight push instructions; must still be safely relocatable on every build.
const expected_prologue = [_]u8{ 0x41, 0x57, 0x41, 0x56, 0x41, 0x55, 0x41, 0x54, 0x56, 0x57, 0x55, 0x53 };

// --- bindings -----------------------------------------------------------------

extern "kernel32" fn GetModuleHandleA(?[*:0]const u8) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn VirtualAlloc(?*anyopaque, usize, u32, u32) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn GetTickCount64() callconv(.winapi) u64;
extern "kernel32" fn CreateFileA([*:0]const u8, u32, u32, ?*anyopaque, u32, u32, ?w.HANDLE) callconv(.winapi) w.HANDLE;
extern "kernel32" fn WriteFile(w.HANDLE, [*]const u8, u32, *u32, ?*anyopaque) callconv(.winapi) w.BOOL;
extern "kernel32" fn FlushFileBuffers(w.HANDLE) callconv(.winapi) w.BOOL;
extern "kernel32" fn CloseHandle(w.HANDLE) callconv(.winapi) w.BOOL;
/// Unwinds through the .pdata of every module on the stack (ours and GameAssembly's), so it
/// walks past the detour and the game's own frames without knowing any frame sizes.
extern "ntdll" fn RtlCaptureStackBackTrace(u32, u32, [*]?*anyopaque, ?*u32) callconv(.winapi) u16;

/// Provided by hit_hook.c; each detour tail-calls through its own stub.
extern var hit_hook_original: u64;
extern var hit_hook_original_handle: u64;
extern var hit_hook_original_list: u64;
extern var hit_hook_original_cont: u64;
extern fn hit_hook_trigger() callconv(.c) void;
extern fn hit_hook_handle() callconv(.c) void;
extern fn hit_hook_list() callconv(.c) void;
extern fn hit_hook_cont() callconv(.c) void;

const MEM_COMMIT_RESERVE: u32 = 0x1000 | 0x2000;
const PAGE_EXECUTE_READWRITE: u32 = 0x40;

// --- output -------------------------------------------------------------------

var out: ?w.HANDLE = null;
var buf: [32 << 10]u8 = undefined;
var len: usize = 0;
/// Hits seen this launch; capture.zig takes the difference across a battle.
pub var hits: u64 = 0;
/// Clock origin shared with eventlog.zig so the two logs join on elapsed_ms; owned by capture.zig.
const started = &capture.started;
/// GameAssembly.dll base, set in install(); return addresses are logged relative to it.
var game_base: u64 = 0;
var game_size: u64 = 0;

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

// --- safe field reads ----------------------------------------------------------
// We are on the game thread inside the hit path, so these are ordinary reads --
// ReadProcessMemory per field would be far too slow. Null checks only; a bad
// non-null pointer would fault, but at this point the game is mid-call on its
// own object and the pointers are as valid as the game's own.

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
fn readU8(base: u64, off: usize) u8 {
    if (base == 0) return 0;
    return @as(*const u8, @ptrFromInt(@as(usize, @intCast(base)) + off)).*;
}

/// Called from hit_hook.c on every attack-pattern trigger. `ret` is the detour's return
/// address, i.e. the return into the game function that called the hooked method.
export fn hitlog_record(self: u64, a1: u64, a2: u64, a3: u64, via: u8, ret: u64) callconv(.c) void {
    if (out == null) return;

    const dyn = readPtr(self, resolved.anim_event_active_dynamic_prop);
    const prop = readPtr(self, resolved.anim_event_attack_property);
    // Same convention as damage_probe.c's caller/caller_rva: RVA within GameAssembly, else 0
    // (a return into another module, or a trampoline).
    const ret_rva: u64 = if (ret >= game_base and ret < game_base + game_size) ret - game_base else 0;

    hits += 1;
    emit(
        "{d}\t0x{X}\t0x{X}\t0x{X}\t0x{X}\t{d}\t{d}\t{d:.6}\t{d:.6}\t{d:.6}\t{d:.6}\t{d:.6}\t{d}\t{d}\t{d}\t{d}\t{d}\t0x{X}\t0x{X}\t0x{X}\t0x{X}\t0x{X}\t0x{X}\t{c}\t0x{X}\t0x{X}",
        .{
            GetTickCount64() - started.*,
            self,
            a1,
            a2,
            a3,
            readI32(self, resolved.anim_event_attack_pattern_type),
            readI32(dyn, resolved.dyn_override_key),
            readF32(dyn, resolved.dyn_damage_ratio),
            readF32(dyn, resolved.dyn_break_stun_ratio),
            readF32(dyn, resolved.dyn_element_accum),
            readF32(dyn, resolved.dyn_ep_recovery),
            readF32(dyn, resolved.dyn_custom_percent),
            readI32(prop, resolved.prop_damage_element),
            readI32(prop, resolved.prop_damage_hit_type),
            readI32(prop, resolved.prop_hit_type),
            readU8(prop, resolved.prop_is_cause_stun),
            readU8(prop, resolved.prop_is_heavy_attack),
            // schema 2: the two config objects themselves, so the hit result can be joined by identity
            dyn,
            prop,
            // schema 3: the config objects the hit result is seen to reference -> join by identity
            readPtr(self, resolved.anim_event_attack_effect),
            readPtr(prop, resolved.prop_ground_hit_effect),
            readPtr(prop, resolved.prop_down_hit_effect),
            readPtr(prop, resolved.prop_sky_hit_effect),
            // schema 4: which entry point produced the row (T dispatcher, H/L/C leaves)
            via,
            // schema 5: the detour's return address and its GameAssembly RVA -- the immediate
            // caller of the hooked method (docs/action-start-hook-plan.md, step 1)
            ret,
            ret_rva,
        },
    );
    // schema 6: the frames above the immediate caller, as GameAssembly RVAs (`*` prefix for an
    // address outside the module). Skips two frames -- the return into the detour and the
    // detour's own return address, which is `ret` above -- so the first entry is the caller's
    // caller. Twelve because the anim-event path crosses two delegate-invoke thunks before its
    // driver (2026-09-18 run 2). Ends the row.
    var frames: [12]?*anyopaque = undefined;
    const n = RtlCaptureStackBackTrace(2, frames.len, &frames, null);
    emit("\t", .{});
    var i: usize = 0;
    while (i < n) : (i += 1) {
        const f: u64 = @intFromPtr(frames[i]);
        const sep: []const u8 = if (i == 0) "" else ";";
        if (f >= game_base and f < game_base + game_size)
            emit("{s}0x{X}", .{ sep, f - game_base })
        else
            emit("{s}*0x{X}", .{ sep, f });
    }
    emit("\n", .{});
    // Flush regularly: a crash later should not cost the hits already seen.
    if (hits % 16 == 0) flush();
}

// --- install -------------------------------------------------------------------

const Interception = @import("Interception.zig");

/// Hook one entry point: verify the eight-push prologue, build the relocation stub,
/// publish it in `original`, then redirect the entry to `detour`.
fn installOne(syscall: *nt.Syscall, base: usize, rva: usize, name: []const u8, original: *u64, detour: anytype) !void {
    const target = base + rva;
    const actual: *const [expected_prologue.len]u8 = @ptrFromInt(target);
    if (!std.mem.eql(u8, actual, &expected_prologue)) {
        log.err("prologue mismatch for {s} at 0x{X} -- wrong client version, not patching", .{ name, target });
        return error.PrologueMismatch;
    }
    // Stub: the 12 relocated prologue bytes, then an absolute jump back to
    // target+12. `jmp [rip+0]` is ff 25 00 00 00 00 followed by the address.
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
    original.* = @intFromPtr(stub);
    // Now redirect the entry point. thaumiel's trampoline is exactly 12 bytes,
    // which is exactly the prologue we relocated.
    _ = try Interception.replace(syscall, target, detour);
    log.info("hooked {s} at 0x{X}, stub 0x{X}", .{ name, target, @intFromPtr(stub) });
}

fn resolve(base: usize) !Resolved {
    try dumper.beginLookup();
    defer dumper.endLookup();
    const anim = try dumper.findClass("MoleMole.Config", "ConfigEntityAnimEvent");
    const dyn = try dumper.findClass("MoleMole.Config", "ConfigAttackActiveFrameDynamicProp");
    const prop = try dumper.findClass("MoleMole.Config", "ConfigEntityAttackProperty");
    var result: Resolved = undefined;
    result.trigger_rva = (dumper.findMethod(anim, "TriggerAttackPattern", 12) catch |err| {
        log.err("lookup ConfigEntityAnimEvent::TriggerAttackPattern failed: {t}", .{err});
        return err;
    }) - base;
    log.info("ConfigEntityAnimEvent::TriggerAttackPattern RVA 0x{X}", .{result.trigger_rva});
    result.handle_rva = (dumper.findMethod(anim, "HandleAttackPattern", 12) catch |err| {
        log.err("lookup ConfigEntityAnimEvent::HandleAttackPattern failed: {t}", .{err});
        return err;
    }) - base;
    log.info("ConfigEntityAnimEvent::HandleAttackPattern RVA 0x{X}", .{result.handle_rva});
    result.list_rva = (dumper.findMethod(anim, "HandleAttackPatternList", 11) catch |err| {
        log.err("lookup ConfigEntityAnimEvent::HandleAttackPatternList failed: {t}", .{err});
        return err;
    }) - base;
    log.info("ConfigEntityAnimEvent::HandleAttackPatternList RVA 0x{X}", .{result.list_rva});
    result.cont_rva = (dumper.findMethod(anim, "HandleContinuousAttackPatternList", 7) catch |err| {
        log.err("lookup ConfigEntityAnimEvent::HandleContinuousAttackPatternList failed: {t}", .{err});
        return err;
    }) - base;
    log.info("ConfigEntityAnimEvent::HandleContinuousAttackPatternList RVA 0x{X}", .{result.cont_rva});
    result.anim_event_active_dynamic_prop = dumper.findField(anim, "ActiveDynamicProp") catch |err| {
        log.err("lookup field ConfigEntityAnimEvent::ActiveDynamicProp failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigEntityAnimEvent::ActiveDynamicProp 0x{X}", .{result.anim_event_active_dynamic_prop});
    result.anim_event_attack_property = dumper.findField(anim, "AttackProperty") catch |err| {
        log.err("lookup field ConfigEntityAnimEvent::AttackProperty failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigEntityAnimEvent::AttackProperty 0x{X}", .{result.anim_event_attack_property});
    result.anim_event_attack_pattern_type = dumper.findField(anim, "AttackPatternType") catch |err| {
        log.err("lookup field ConfigEntityAnimEvent::AttackPatternType failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigEntityAnimEvent::AttackPatternType 0x{X}", .{result.anim_event_attack_pattern_type});
    result.anim_event_attack_effect = dumper.findField(anim, "AttackEffect") catch |err| {
        log.err("lookup field ConfigEntityAnimEvent::AttackEffect failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigEntityAnimEvent::AttackEffect 0x{X}", .{result.anim_event_attack_effect});
    result.prop_down_hit_effect = dumper.findField(prop, "DownHitEffect") catch |err| {
        log.err("lookup field ConfigEntityAttackProperty::DownHitEffect failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigEntityAttackProperty::DownHitEffect 0x{X}", .{result.prop_down_hit_effect});
    result.prop_sky_hit_effect = dumper.findField(prop, "SkyHitEffect") catch |err| {
        log.err("lookup field ConfigEntityAttackProperty::SkyHitEffect failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigEntityAttackProperty::SkyHitEffect 0x{X}", .{result.prop_sky_hit_effect});
    result.prop_ground_hit_effect = dumper.findField(prop, "GroundHitEffect") catch |err| {
        log.err("lookup field ConfigEntityAttackProperty::GroundHitEffect failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigEntityAttackProperty::GroundHitEffect 0x{X}", .{result.prop_ground_hit_effect});
    result.dyn_override_key = dumper.findField(dyn, "OverrdieDynamicPropKey") catch |err| {
        log.err("lookup field ConfigAttackActiveFrameDynamicProp::OverrdieDynamicPropKey failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigAttackActiveFrameDynamicProp::OverrdieDynamicPropKey 0x{X}", .{result.dyn_override_key});
    result.dyn_custom_percent = dumper.findField(dyn, "CustomAttackPropertyPercent") catch |err| {
        log.err("lookup field ConfigAttackActiveFrameDynamicProp::CustomAttackPropertyPercent failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigAttackActiveFrameDynamicProp::CustomAttackPropertyPercent 0x{X}", .{result.dyn_custom_percent});
    result.dyn_ether_purify = dumper.findField(dyn, "EtherPurifyPercentage") catch |err| {
        log.err("lookup field ConfigAttackActiveFrameDynamicProp::EtherPurifyPercentage failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigAttackActiveFrameDynamicProp::EtherPurifyPercentage 0x{X}", .{result.dyn_ether_purify});
    result.dyn_damage_ratio = dumper.findField(dyn, "DamageRatioPercent") catch |err| {
        log.err("lookup field ConfigAttackActiveFrameDynamicProp::DamageRatioPercent failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigAttackActiveFrameDynamicProp::DamageRatioPercent 0x{X}", .{result.dyn_damage_ratio});
    result.dyn_ep_recovery = dumper.findField(dyn, "EpRecoveryPercent") catch |err| {
        log.err("lookup field ConfigAttackActiveFrameDynamicProp::EpRecoveryPercent failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigAttackActiveFrameDynamicProp::EpRecoveryPercent 0x{X}", .{result.dyn_ep_recovery});
    result.dyn_break_stun_ratio = dumper.findField(dyn, "BreakStunRatioPercent") catch |err| {
        log.err("lookup field ConfigAttackActiveFrameDynamicProp::BreakStunRatioPercent failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigAttackActiveFrameDynamicProp::BreakStunRatioPercent 0x{X}", .{result.dyn_break_stun_ratio});
    result.dyn_element_accum = dumper.findField(dyn, "ElementAbnormalAccumPercent") catch |err| {
        log.err("lookup field ConfigAttackActiveFrameDynamicProp::ElementAbnormalAccumPercent failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigAttackActiveFrameDynamicProp::ElementAbnormalAccumPercent 0x{X}", .{result.dyn_element_accum});
    result.prop_damage_element = dumper.findField(prop, "DamageElement") catch |err| {
        log.err("lookup field ConfigEntityAttackProperty::DamageElement failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigEntityAttackProperty::DamageElement 0x{X}", .{result.prop_damage_element});
    result.prop_damage_hit_type = dumper.findField(prop, "DamageHitType") catch |err| {
        log.err("lookup field ConfigEntityAttackProperty::DamageHitType failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigEntityAttackProperty::DamageHitType 0x{X}", .{result.prop_damage_hit_type});
    result.prop_hit_type = dumper.findField(prop, "HitType") catch |err| {
        log.err("lookup field ConfigEntityAttackProperty::HitType failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigEntityAttackProperty::HitType 0x{X}", .{result.prop_hit_type});
    result.prop_is_cause_stun = dumper.findField(prop, "IsCauseStun") catch |err| {
        log.err("lookup field ConfigEntityAttackProperty::IsCauseStun failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigEntityAttackProperty::IsCauseStun 0x{X}", .{result.prop_is_cause_stun});
    result.prop_is_heavy_attack = dumper.findField(prop, "IsHeavyAttack") catch |err| {
        log.err("lookup field ConfigEntityAttackProperty::IsHeavyAttack failed: {t}", .{err});
        return err;
    };
    log.info("field ConfigEntityAttackProperty::IsHeavyAttack 0x{X}", .{result.prop_is_heavy_attack});
    return result;
}

fn install(syscall: *nt.Syscall) !void {
    const module = GetModuleHandleA("GameAssembly.dll") orelse return error.NoGameAssembly;
    const base = @intFromPtr(module);
    game_base = base;
    const e_lfanew = std.mem.readInt(u32, @as(*const [4]u8, @ptrFromInt(base + 0x3c)), .little);
    const timestamp = std.mem.readInt(u32, @as(*const [4]u8, @ptrFromInt(base + e_lfanew + 8)), .little);
    const size_of_image = std.mem.readInt(u32, @as(*const [4]u8, @ptrFromInt(base + e_lfanew + 0x50)), .little);
    game_size = size_of_image;
    log.info("GameAssembly timestamp 0x{X} SizeOfImage 0x{X}", .{ timestamp, size_of_image });
    resolved = try resolve(base);
    if (timestamp == known_3_3_2.timestamp and size_of_image == known_3_3_2.size_of_image) {
        inline for (std.meta.fields(Resolved)) |field| {
            const actual = @field(resolved, field.name);
            const known = @field(known_3_3_2.values, field.name);
            if (actual != known) log.warn("CNBetaWin3.3.2 CROSS-CHECK MISMATCH {s}: resolved 0x{X}, known 0x{X} (warning only)", .{ field.name, actual, known });
        }
    }
    // All four prologues are checked before any patch is written, so a version
    // mismatch on any of them leaves the client untouched.
    inline for (.{ resolved.trigger_rva, resolved.handle_rva, resolved.list_rva, resolved.cont_rva }) |rva| {
        const actual: *const [expected_prologue.len]u8 = @ptrFromInt(base + rva);
        if (!std.mem.eql(u8, actual, &expected_prologue)) {
            log.err("prologue mismatch at 0x{X} -- wrong client version, not patching anything", .{base + rva});
            return error.PrologueMismatch;
        }
    }
    try installOne(syscall, base, resolved.trigger_rva, "TriggerAttackPattern", &hit_hook_original, hit_hook_trigger);
    try installOne(syscall, base, resolved.handle_rva, "HandleAttackPattern", &hit_hook_original_handle, hit_hook_handle);
    try installOne(syscall, base, resolved.list_rva, "HandleAttackPatternList", &hit_hook_original_list, hit_hook_list);
    try installOne(syscall, base, resolved.cont_rva, "HandleContinuousAttackPatternList", &hit_hook_original_cont, hit_hook_cont);
}

/// Open `<battle folder>\hits.tsv` with its header; the clock origin is capture.zig's.
fn open() void {
    var path: capture.PathBuf = undefined;
    out = CreateFileA(capture.battlePath(&path, "hits.tsv"), 0x40000000, 1, null, 2, 0x80, null);
    if (out == w.INVALID_HANDLE_VALUE) {
        out = null;
        log.err("could not create hits.tsv", .{});
        return;
    }
    emit("elapsed_ms\tself\targ1\targ2\targ3\tpatternType\tskillId\tdmgPct\tdazePct\tbuildupPct\tepPct\tcustomPct\telement\thitType\thitStren\tcauseStun\theavy\tdyn\tprop\tattackEffect\tgroundHitEffect\tdownHitEffect\tskyHitEffect\tvia\tcaller\tcallerRva\tstack\n", .{});
    flush();
}

pub fn start(_: *nt.Syscall) void {
    open();
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

/// Called only by dumper's initially unattached worker, after validateTable().
pub fn installFromWorker() void {
    if (out == null) {
        log.err("hitlog install refused: hits.tsv is not open", .{});
        return;
    }
    var syscall: nt.Syscall = .init;
    install(&syscall) catch |err| {
        log.err("hitlog install failed: {t}", .{err});
        return;
    };
    log.info("all four hit hooks installed; waiting for hits", .{});
}
