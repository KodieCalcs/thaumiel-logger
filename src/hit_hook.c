// Detours for MoleMole.Config.ConfigEntityAnimEvent's attack-pattern entry points.
//
// Written in C rather than as naked asm stubs so the compiler handles all the
// register/stack marshalling: we declare the same arity as the real method and
// pass every argument straight through. In the Win64 ABI every stack argument
// occupies an 8-byte slot regardless of its declared type, so taking them all
// as uint64_t preserves them exactly -- the real callee reads whichever low
// bits it cares about.
//
// il2cpp instance methods are `ret f(void* this, params..., MethodInfo*)`.
//
//   TriggerAttackPattern              12 params -> 14   'T'   the dispatcher
//   HandleAttackPattern               12 params -> 14   'H'   leaf
//   HandleAttackPatternList           11 params -> 13   'L'   leaf (also via ...WithOverrideParam)
//   HandleContinuousAttackPatternList  7 params ->  9   'C'   leaf
//
// Trigger calls exactly one leaf per call, so ordinary hits produce a 'T' row
// and a leaf row; attacks that bypass Trigger produce only a leaf row. Rows are
// tagged so the reader can dedupe.

#include <stdint.h>

// Implemented in hitlog.zig. Must not throw and must be quick; it runs on the
// game thread inside the hit path. `ret` is the detour's own return address: the
// entry is reached by a `jmp` from the patched prologue, so the stack is still the
// original caller's and this is the return into whoever called the hooked method.
extern void hitlog_record(uint64_t self, uint64_t a1, uint64_t a2, uint64_t a3, uint8_t via,
                          uint64_t ret);

// The return-address intrinsic only means "the caller" if the detour is a real
// frame of its own, so keep the compiler from inlining/merging these.
#define DETOUR __attribute__((noinline))

// Set by hitlog.zig to the relocated-prologue stubs before each patch goes live.
uint64_t hit_hook_original = 0;          // TriggerAttackPattern
uint64_t hit_hook_original_handle = 0;   // HandleAttackPattern
uint64_t hit_hook_original_list = 0;     // HandleAttackPatternList
uint64_t hit_hook_original_cont = 0;     // HandleContinuousAttackPatternList

typedef void (*fn14)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t,
                     uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t);
typedef void (*fn13)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t,
                     uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t);
typedef void (*fn9)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t,
                    uint64_t, uint64_t);

// Tail into the original. If a stub is missing, returning is safer than
// jumping to null -- the game loses one attack event, rather than crashing.

DETOUR void hit_hook_trigger(uint64_t self, uint64_t a1, uint64_t a2, uint64_t a3,
                      uint64_t a4, uint64_t a5, uint64_t a6, uint64_t a7,
                      uint64_t a8, uint64_t a9, uint64_t a10, uint64_t a11,
                      uint64_t a12, uint64_t method) {
    hitlog_record(self, a1, a2, a3, 'T', (uint64_t)__builtin_return_address(0));
    fn14 original = (fn14)hit_hook_original;
    if (original) original(self, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, method);
}

DETOUR void hit_hook_handle(uint64_t self, uint64_t a1, uint64_t a2, uint64_t a3,
                     uint64_t a4, uint64_t a5, uint64_t a6, uint64_t a7,
                     uint64_t a8, uint64_t a9, uint64_t a10, uint64_t a11,
                     uint64_t a12, uint64_t method) {
    hitlog_record(self, a1, a2, a3, 'H', (uint64_t)__builtin_return_address(0));
    fn14 original = (fn14)hit_hook_original_handle;
    if (original) original(self, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, method);
}

DETOUR void hit_hook_list(uint64_t self, uint64_t a1, uint64_t a2, uint64_t a3,
                   uint64_t a4, uint64_t a5, uint64_t a6, uint64_t a7,
                   uint64_t a8, uint64_t a9, uint64_t a10, uint64_t a11,
                   uint64_t method) {
    hitlog_record(self, a1, a2, a3, 'L', (uint64_t)__builtin_return_address(0));
    fn13 original = (fn13)hit_hook_original_list;
    if (original) original(self, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, method);
}

DETOUR void hit_hook_cont(uint64_t self, uint64_t a1, uint64_t a2, uint64_t a3,
                   uint64_t a4, uint64_t a5, uint64_t a6, uint64_t a7,
                   uint64_t method) {
    hitlog_record(self, a1, a2, a3, 'C', (uint64_t)__builtin_return_address(0));
    fn9 original = (fn9)hit_hook_original_cont;
    if (original) original(self, a1, a2, a3, a4, a5, a6, a7, method);
}
