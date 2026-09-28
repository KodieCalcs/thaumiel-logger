//! 3.3.3 pins re-derived from full method bodies; see docs/hooks-333-validation.md.
//! Historical 3.3.2 traces below describe the same ABI, not the current addresses.
//! Buff / property / stun state log: `state.tsv` in the battle folder, one row per change of
//! something the per-hit log can only see indirectly. It answers the three questions the hit
//! log cannot: when a buff went on or off and on whom, what the entity's own stat table said at
//! that moment, and when the target's Stun actually started and ended.
//!
//! Row kinds (`kind` column), all sharing `elapsed_ms` with hits.tsv / events.tsv / timescale.tsv:
//!
//!   prop      a write to an entity's property table -- `FNNLNAIBANN::DMIOODAONDK(type, key,
//!             mode, value)` @ 3.3.2 `0x18106F70`, the one function 173 call sites use to change
//!             a stat. `type` is `Share.EPropertyType` (the same ids the damage path reads back
//!             through `GEIEAAJJJDC::HNIBECLNDNL`, so ATK 3370.4 etc. identify them by value),
//!             `key` the named-buff key string, `value` what was asked for and `out` what the
//!             call returned.
//!   notify    the broadcast that follows a change the listeners care about --
//!             `MGBLBALKPKM::BGOHPIKJCFB(type, key, value)` @ `0x17BD6F60`. The stun mixin's
//!             own `OnFighter_PropertyValueChanged` is one of its listeners, so a `notify` row
//!             is the moment a CurStun / MaxStun / ATK change became visible to the rest of the
//!             engine.
//!   mod+      a modifier (buff) instance was initialised -- `BALGGDCFODF::AFNFONFKKBH(ability,
//!             owner, config, x)` @ `0x146FB120`. Carries the modifier's NAME from its config
//!             (`GBCCPCMJCGE+0x800`, the string `ToString` prints), both entity pointers, the
//!             stacking mode (`+0x98c`) and the config's float/int parameters.
//!   modA      the instance attached -- `JELANNGODEG()` @ `0x146FC4F0` (it sets `+0x220`, the
//!             slot index, and clears `+0x21c`).
//!   modD      the instance detached -- `CEIMOJLFNFD()` @ `0x146FDBC0`, recorded BEFORE the
//!             call so the stack count and slot are still readable.
//!   grace+    the Daze **no-decay grace** opened -- `GILABPBBMJH::KFJONGLHNPM()` @ `0x1A4FB4D0`
//!             sets `+0xcb` and loads `+0xe0` from the config. NOT the Stun: measured against
//!             capture `20260922-142706` it fired once, mid-Stun, while the real Stun ran
//!             61.9-85.9 s. `KDOLAAIANGF(dt)` `0x1A4F4DE0` shows what `+0xcb` gates -- while it
//!             is set the per-frame Daze decay term is forced to zero -- so this pair is the
//!             "recently hit, meter does not drain" window, worth logging in its own right.
//!   grace~/-  that window's first observed frame and the frame `+0xe0` ran out.
//!
//! **The Stun window itself needs no hook of its own.** It is in the `prop` rows: CurStun is
//! property type 11, and the capture above shows it clamped to MaxStun 17582.70 at 61.875 s
//! (the hit log's first stunned hit is 61.9 s) and then draining. Stun start = the write clamped
//! at the cap, Stun end = the write reaching 0, and a Reset is a re-fill during the drain.
//! `tools/state-check.mjs` derives the window that way.
//!
//! Everything is read with plain dereferences behind a null check -- these run on the game
//! thread inside the call being logged, exactly as hitlog.zig does. No game functions are
//! called and nothing is written to game memory.
//!
//! Class, method and field names are obfuscated and CHANGE EVERY BUILD. Every one below is
//! resolved by name through the dumper and checked against the pinned RVA/offsets; any mismatch
//! installs nothing and logs `error(statelog)` in hitlog-startup.log. To re-find them after a
//! client update see docs/client-update-playbook.md and the trace in docs/damage-probe-howto.md
//! ("Buff, property and stun state", 2026-09-22).

const std = @import("std");
const w = std.os.windows;

const nt = @import("nt.zig");
const dumper = @import("dumper.zig");
const capture = @import("capture.zig");
const detour = @import("detour.zig");
const LogFile = @import("logfile.zig").LogFile;

const log = std.log.scoped(.statelog);

extern "kernel32" fn GetModuleHandleA(?[*:0]const u8) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn GetTickCount64() callconv(.winapi) u64;

// --- targets and fields: src/pins.zig, by stable name ---------------------------------
// Generated from tools/update/pins/<client>.json by `tools/update/rederive.py emit`; the re-derivation
// (class match, shape match, property_set's caller-count tie-break, register-disciplined field
// witnesses) is `rederive.py match`. Every value is still checked against the dump at install.

const pins = @import("pins.zig");

const Target = struct {
    class: []const u8,
    method: []const u8,
    params: usize,
    rva: usize,
    prologue: []const u8,
    shape: detour.Shape,
};

fn target(comptime C: type, comptime member: []const u8, comptime shape: detour.Shape) Target {
    const class = C.class_name; // referenced first: string literals are laid out in first-use order
    const m = @field(C, member);
    return .{ .class = class, .method = m.name, .params = m.params, .rva = m.rva, .prologue = &@field(C, member ++ "_prologue"), .shape = shape };
}

const t_property_set = target(pins.PropertyTable, "set", .plain);
const t_property_notify = target(pins.PropertyNotifier, "notify", .plain);
const t_modifier_init = target(pins.ModifierInstance, "init", .plain);
const t_modifier_attach = target(pins.ModifierInstance, "attach", .cmp_rip);
const t_modifier_detach = target(pins.ModifierInstance, "detach", .cmp_rip);
const t_stun_enter = target(pins.StunMixin, "enter", .plain);
const t_stun_update = target(pins.StunMixin, "update", .plain);

const Field = struct { class: []const u8, name: []const u8, offset: usize };

fn field(comptime C: type, comptime member: []const u8) Field {
    return .{ .class = C.class_name, .name = @field(C, member).name, .offset = @field(C, member).offset };
}

/// The modifier instance.
const m_owner = field(pins.ModifierInstance, "owner");
const m_caster = field(pins.ModifierInstance, "caster");
const m_ability = field(pins.ModifierInstance, "ability");
const m_config = field(pins.ModifierInstance, "config");
const m_flags = field(pins.ModifierInstance, "flags");
const m_slot = field(pins.ModifierInstance, "slot");
const m_stacks = field(pins.ModifierInstance, "stacks");

/// The modifier's config asset.
const c_name = field(pins.ModifierConfig, "name");
const c_stacking = field(pins.ModifierConfig, "stacking");
const c_duration = field(pins.ModifierConfig, "duration");
const c_max_stacks = field(pins.ModifierConfig, "max_stacks");

/// The stun mixin (the same component the Daze probe reads).
const s_entity = field(pins.StunMixin, "entity");
const s_cur_at_entry = field(pins.StunMixin, "cur_at_entry");
const s_entered = field(pins.StunMixin, "entered");
const s_stunned = field(pins.StunMixin, "stunned");
const s_config_value = field(pins.StunMixin, "config_value");
const s_cur_stun = field(pins.StunMixin, "cur_stun");
const s_remaining = field(pins.StunMixin, "remaining");

const all_fields = [_]Field{
    m_owner,  m_caster,      m_ability,  m_config,        m_flags,   m_slot,       m_stacks,
    c_name,   c_stacking,    c_duration, c_max_stacks,    s_entity,  s_cur_at_entry, s_entered,
    s_stunned, s_config_value, s_cur_stun, s_remaining,
};

// --- output ------------------------------------------------------------------------

var file: LogFile = .{
    .name = "state.tsv",
    .header = "elapsed_ms\tkind\tself\ta\tb\tc\td\ti0\ti1\tf0\tf1\tname\tcaller\n",
};
var game_base: usize = 0;
var installed = false;

fn rva(address: u64) u64 {
    if (game_base == 0 or address < game_base) return 0;
    return address - game_base;
}

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

/// Copy a System.String (length at +0x10, UTF-16 at +0x14) as ASCII; non-ASCII becomes '?'.
/// Tabs, newlines and the empty string are neutralised so a row can never break the TSV.
fn readString(str: u64, out: []u8) []const u8 {
    if (str == 0) return "";
    const len = readI32(str, 0x10);
    if (len <= 0 or len > 4096) return "";
    const n = @min(@as(usize, @intCast(len)), out.len);
    const chars: [*]const u16 = @ptrFromInt(@as(usize, @intCast(str)) + 0x14);
    for (0..n) |i| {
        const c = chars[i];
        out[i] = if (c >= 0x20 and c < 0x7f) @intCast(c) else '?';
    }
    return out[0..n];
}

fn now() u64 {
    return GetTickCount64() - capture.started;
}

// --- records (called from state_hook.c, on the game thread) -------------------------

export fn statelog_property_set(store: u64, kind: u32, key: u64, mode: u32, in: f64, out: f64, caller: u64) callconv(.c) void {
    if (file.out == null) return;
    var buf: [256]u8 = undefined;
    const name = readString(key, &buf);
    file.emit("{d}\tprop\t0x{X}\t\t\t\t\t{d}\t{d}\t{d}\t{d}\t{s}\t0x{X}\n", .{ now(), store, kind, mode, in, out, name, rva(caller) });
}

export fn statelog_property_notify(entity: u64, kind: u32, key: u64, value: f64, caller: u64) callconv(.c) void {
    if (file.out == null) return;
    var buf: [256]u8 = undefined;
    const name = readString(key, &buf);
    file.emit("{d}\tnotify\t0x{X}\t\t\t\t\t{d}\t\t{d}\t\t{s}\t0x{X}\n", .{ now(), entity, kind, value, name, rva(caller) });
}

export fn statelog_modifier_init(self: u64, ability: u64, owner: u64, config: u64, extra: u64, caller: u64) callconv(.c) void {
    if (file.out == null) return;
    // The instance has already copied these into its own fields (the trace in the module
    // comment); they are taken from `self` so the row and the later mod rows agree.
    _ = ability;
    _ = owner;
    _ = config;
    _ = extra;
    const cfg = readPtr(self, m_config.offset);
    var buf: [256]u8 = undefined;
    const name = readString(readPtr(cfg, c_name.offset), &buf);
    file.emit("{d}\tmod+\t0x{X}\t0x{X}\t0x{X}\t0x{X}\t0x{X}\t{d}\t{d}\t{d}\t{d}\t{s}\t0x{X}\n", .{
        now(),
        self,
        readPtr(self, m_owner.offset),
        readPtr(self, m_caster.offset),
        readPtr(self, m_ability.offset),
        cfg,
        readI32(cfg, c_stacking.offset),
        readI32(cfg, c_max_stacks.offset),
        readF32(cfg, c_duration.offset),
        @as(f32, @floatFromInt(readI32(self, m_stacks.offset))),
        name,
        rva(caller),
    });
}

export fn statelog_modifier_event(self: u64, kind: u32, caller: u64) callconv(.c) void {
    if (file.out == null) return;
    const cfg = readPtr(self, m_config.offset);
    var buf: [256]u8 = undefined;
    const name = readString(readPtr(cfg, c_name.offset), &buf);
    const label = if (kind == 'A') "modA" else "modD";
    file.emit("{d}\t{s}\t0x{X}\t0x{X}\t\t\t0x{X}\t{d}\t{d}\t\t\t{s}\t0x{X}\n", .{
        now(),
        label,
        self,
        readPtr(self, m_owner.offset),
        cfg,
        readI32(self, m_slot.offset),
        readI32(self, m_stacks.offset),
        name,
        rva(caller),
    });
}

export fn statelog_stun_enter(self: u64, caller: u64) callconv(.c) void {
    if (file.out == null) return;
    file.emit("{d}\tgrace+\t0x{X}\t0x{X}\t\t\t\t{d}\t{d}\t{d}\t{d}\t\t0x{X}\n", .{
        now(),
        self,
        readPtr(self, s_entity.offset),
        readU8(self, s_entered.offset),
        readU8(self, s_stunned.offset),
        readF32(self, s_cur_stun.offset),
        readF32(self, s_remaining.offset),
        rva(caller),
    });
}

/// Per-frame; writes a row only on the first frame of a Stun (the duration the enter assigned
/// is now readable) and on the frame the timer runs out.
var last_stunned: u8 = 0;
var last_self: u64 = 0;
/// False until the first frame of a battle has been seen, so the first observation of a
/// component is not mistaken for a transition (capture 20260922-142706 logged one such row).
var seen_update = false;

export fn statelog_stun_update(self: u64, dt: f32) callconv(.c) void {
    if (file.out == null or self == 0) return;
    const stunned = readU8(self, s_stunned.offset);
    const first = !seen_update or self != last_self;
    seen_update = true;
    if (first) {
        last_self = self;
        last_stunned = stunned;
        return;
    }
    if (stunned == last_stunned) return;
    if (stunned != 0) {
        file.emit("{d}\tgrace~\t0x{X}\t0x{X}\t\t\t\t\t\t{d}\t{d}\t\t\n", .{
            now(), self, readPtr(self, s_entity.offset), readF32(self, s_remaining.offset), readF32(self, s_cur_at_entry.offset),
        });
    } else {
        file.emit("{d}\tgrace-\t0x{X}\t0x{X}\t\t\t\t\t\t{d}\t{d}\t\t\n", .{
            now(), self, readPtr(self, s_entity.offset), readF32(self, s_cur_stun.offset), readF32(self, s_config_value.offset),
        });
    }
    _ = dt;
    last_self = self;
    last_stunned = stunned;
}

// --- install ---------------------------------------------------------------------

extern var state_hook_original_property_set: u64;
extern var state_hook_original_property_notify: u64;
extern var state_hook_original_modifier_init: u64;
extern var state_hook_original_modifier_attach: u64;
extern var state_hook_original_modifier_detach: u64;
extern var state_hook_original_stun_enter: u64;
extern var state_hook_original_stun_update: u64;

extern fn state_hook_property_set() callconv(.c) void;
extern fn state_hook_property_notify() callconv(.c) void;
extern fn state_hook_modifier_init() callconv(.c) void;
extern fn state_hook_modifier_attach() callconv(.c) void;
extern fn state_hook_modifier_detach() callconv(.c) void;
extern fn state_hook_stun_enter() callconv(.c) void;
extern fn state_hook_stun_update() callconv(.c) void;

fn resolveOne(base: usize, t: Target) !usize {
    const klass = dumper.findClass("", t.class) catch |err| {
        log.err("lookup {s} failed: {t} (obfuscated name; see module comment)", .{ t.class, err });
        return err;
    };
    const method = dumper.findMethod(klass, t.method, t.params) catch |err| {
        log.err("lookup {s}::{s}/{d} failed: {t}", .{ t.class, t.method, t.params, err });
        return err;
    };
    if (method - base != t.rva) {
        log.err("{s}::{s} resolved to RVA 0x{X}, pinned 0x{X} -- not patching", .{ t.class, t.method, method - base, t.rva });
        return error.RvaMismatch;
    }
    if (!detour.matches(method, .{ .prologue = t.prologue, .shape = t.shape })) {
        log.err("{s}::{s} prologue mismatch at 0x{X} -- not patching", .{ t.class, t.method, method });
        return error.PrologueMismatch;
    }
    return method;
}

fn checkFields() !void {
    var last_class: []const u8 = "";
    var klass: usize = 0;
    for (all_fields) |f| {
        if (!std.mem.eql(u8, f.class, last_class)) {
            klass = dumper.findClass("", f.class) catch |err| {
                log.err("lookup {s} failed: {t}", .{ f.class, err });
                return err;
            };
            last_class = f.class;
        }
        const off = dumper.findField(klass, f.name) catch |err| {
            log.err("lookup {s}.{s} failed: {t}", .{ f.class, f.name, err });
            return err;
        };
        if (off != f.offset) {
            log.err("{s}.{s} is at +0x{X}, pinned +0x{X} -- layout changed, not patching", .{ f.class, f.name, off, f.offset });
            return error.FieldOffsetMismatch;
        }
    }
}

/// Called only by dumper's worker, after the other installFromWorker()s: il2cpp is up and the
/// verified API table is available. Every target and every field offset is checked before the
/// first patch is written, so a version mismatch leaves the client completely untouched.
pub fn installFromWorker() void {
    if (file.out == null) {
        log.err("statelog install refused: state.tsv is not open", .{});
        return;
    }
    const base = @intFromPtr(GetModuleHandleA("GameAssembly.dll") orelse {
        log.err("statelog: no GameAssembly.dll", .{});
        return;
    });
    game_base = base;

    dumper.beginLookup() catch |err| {
        log.err("statelog lookup session failed: {t}", .{err});
        return;
    };
    defer dumper.endLookup();

    checkFields() catch return;
    const property_set = resolveOne(base, t_property_set) catch return;
    const property_notify = resolveOne(base, t_property_notify) catch return;
    const modifier_init = resolveOne(base, t_modifier_init) catch return;
    const modifier_attach = resolveOne(base, t_modifier_attach) catch return;
    const modifier_detach = resolveOne(base, t_modifier_detach) catch return;
    const stun_enter = resolveOne(base, t_stun_enter) catch return;
    const stun_update = resolveOne(base, t_stun_update) catch return;

    var syscall: nt.Syscall = .init;
    const specs = .{
        .{ t_property_set, property_set, &state_hook_original_property_set, state_hook_property_set },
        .{ t_property_notify, property_notify, &state_hook_original_property_notify, state_hook_property_notify },
        .{ t_modifier_init, modifier_init, &state_hook_original_modifier_init, state_hook_modifier_init },
        .{ t_modifier_attach, modifier_attach, &state_hook_original_modifier_attach, state_hook_modifier_attach },
        .{ t_modifier_detach, modifier_detach, &state_hook_original_modifier_detach, state_hook_modifier_detach },
        .{ t_stun_enter, stun_enter, &state_hook_original_stun_enter, state_hook_stun_enter },
        .{ t_stun_update, stun_update, &state_hook_original_stun_update, state_hook_stun_update },
    };
    inline for (specs) |s| {
        const t: Target = s[0];
        _ = detour.install(&syscall, s[1], .{ .prologue = t.prologue, .shape = t.shape }, s[2], s[3]) catch |err| {
            log.err("statelog hook {s}::{s} failed: {t} (earlier hooks in this set are live)", .{ t.class, t.method, err });
            return;
        };
        log.info("hooked {s}::{s} at 0x{X}", .{ t.class, t.method, s[1] });
    }
    installed = true;
    log.info("state log installed: buff lifecycle, property writes and Stun windows to state.tsv", .{});
}

// --- lifecycle --------------------------------------------------------------------

pub fn start() void {
    if (!file.open()) log.err("could not create state.tsv", .{});
}

pub fn rotate() void {
    last_self = 0;
    last_stunned = 0;
    seen_update = false;
    file.rotate();
}

pub fn flushAll() void {
    file.flushAll();
}
