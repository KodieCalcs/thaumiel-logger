// Detours for statelog.zig: entity property writes, modifier (buff) lifecycle and the stun
// mixin's enter/update. Same conventions as hit_hook.c / timescale_hook.c: the C signature
// mirrors the il2cpp one (`this, params..., MethodInfo*`), every integer/pointer argument is
// a uint64_t, floats/doubles are declared as such so they travel in the xmm registers the
// original expects, and the relocated-prologue stub is called through the slot statelog.zig
// fills before the patch goes live.
//
// POST-call detours (the original runs first, then the record reads what it just did):
//   FNNLNAIBANN::IOJOOIAFPDM(type, key, mode, double)   -> double   property write; the
//                                                                    return is the new value
//   MGBLBALKPKM::BGOHPIKJCFB(type, key, double)         -> void     property-changed broadcast
//   BALGGDCFODF::AFNFONFKKBH(ability, owner, config, x) -> void     modifier init (fields set)
//   BALGGDCFODF::JELANNGODEG()                           -> void     modifier attached (+0x220 set)
//   GILABPBBMJH::KDOLAAIANGF(float dt)                   -> void     stun mixin update (timer)
// PRE-call detours (the record runs first, the fields are still valid, then the original):
//   BALGGDCFODF::CEIMOJLFNFD()                           -> void     modifier detached
//   GILABPBBMJH::KFJONGLHNPM()                           -> ?        stun enter / reset
//
// The two `?`-returning targets are reached through a vtable (no direct callers in the dump)
// and end in tail jumps whose return type is unknown, so their detours return the original's
// rax unchanged and are written as sibling calls; a caller reading xmm0 would still see it.

#include <stdint.h>

extern void statelog_property_set(uint64_t store, uint32_t type, uint64_t key, uint32_t mode,
                                  double in, double out, uint64_t caller);
extern void statelog_property_notify(uint64_t entity, uint32_t type, uint64_t key, double value,
                                     uint64_t caller);
extern void statelog_modifier_init(uint64_t self, uint64_t ability, uint64_t owner, uint64_t config,
                                   uint64_t extra, uint64_t caller);
extern void statelog_modifier_event(uint64_t self, uint32_t kind, uint64_t caller);
extern void statelog_stun_enter(uint64_t self, uint64_t caller);
extern void statelog_stun_update(uint64_t self, float dt);

#define DETOUR __attribute__((noinline))

uint64_t state_hook_original_property_set = 0;
uint64_t state_hook_original_property_notify = 0;
uint64_t state_hook_original_modifier_init = 0;
uint64_t state_hook_original_modifier_attach = 0;
uint64_t state_hook_original_modifier_detach = 0;
uint64_t state_hook_original_stun_enter = 0;
uint64_t state_hook_original_stun_update = 0;

typedef double (*fn_property_set)(uint64_t, uint32_t, uint64_t, uint32_t, double, uint64_t);
typedef void (*fn_property_notify)(uint64_t, uint32_t, uint64_t, double, uint64_t);
typedef void (*fn_modifier_init)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t);
typedef uint64_t (*fn_this)(uint64_t, uint64_t);
typedef void (*fn_this_float)(uint64_t, float, uint64_t, uint64_t);

DETOUR double state_hook_property_set(uint64_t store, uint32_t type, uint64_t key, uint32_t mode,
                                      double value, uint64_t method) {
    uint64_t caller = (uint64_t)__builtin_return_address(0);
    fn_property_set original = (fn_property_set)state_hook_original_property_set;
    double out = 0.0;
    if (original) out = original(store, type, key, mode, value, method);
    statelog_property_set(store, type, key, mode, value, out, caller);
    return out;
}

DETOUR void state_hook_property_notify(uint64_t entity, uint32_t type, uint64_t key, double value,
                                       uint64_t method) {
    uint64_t caller = (uint64_t)__builtin_return_address(0);
    fn_property_notify original = (fn_property_notify)state_hook_original_property_notify;
    if (original) original(entity, type, key, value, method);
    statelog_property_notify(entity, type, key, value, caller);
}

DETOUR void state_hook_modifier_init(uint64_t self, uint64_t ability, uint64_t owner, uint64_t config,
                                     uint64_t extra, uint64_t method) {
    uint64_t caller = (uint64_t)__builtin_return_address(0);
    fn_modifier_init original = (fn_modifier_init)state_hook_original_modifier_init;
    if (original) original(self, ability, owner, config, extra, method);
    statelog_modifier_init(self, ability, owner, config, extra, caller);
}

DETOUR uint64_t state_hook_modifier_attach(uint64_t self, uint64_t method) {
    uint64_t caller = (uint64_t)__builtin_return_address(0);
    fn_this original = (fn_this)state_hook_original_modifier_attach;
    uint64_t r = 0;
    if (original) r = original(self, method);
    statelog_modifier_event(self, 'A', caller);
    return r;
}

DETOUR uint64_t state_hook_modifier_detach(uint64_t self, uint64_t method) {
    uint64_t caller = (uint64_t)__builtin_return_address(0);
    statelog_modifier_event(self, 'D', caller);
    fn_this original = (fn_this)state_hook_original_modifier_detach;
    if (!original) return 0;
    return original(self, method);
}

DETOUR uint64_t state_hook_stun_enter(uint64_t self, uint64_t method) {
    uint64_t caller = (uint64_t)__builtin_return_address(0);
    statelog_stun_enter(self, caller);
    fn_this original = (fn_this)state_hook_original_stun_enter;
    if (!original) return 0;
    return original(self, method);
}

// `float dt` in xmm1, rdx unused, MethodInfo in r8 (as timescale_hook_update); r9 carried along.
DETOUR void state_hook_stun_update(uint64_t self, float dt, uint64_t method, uint64_t a3) {
    fn_this_float original = (fn_this_float)state_hook_original_stun_update;
    if (original) original(self, dt, method, a3);
    statelog_stun_update(self, dt);
}
