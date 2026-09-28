// Detours for MoleMole.BattleStatsSubsystem::OnAwake / ::OnDestroy (capture.zig): the battle
// lifecycle that rotates the capture folder.
//
// Same shape as event_hook.c: both are `void (this, MethodInfo*)` instance methods, taken as
// six register/stack slots so nothing is disturbed if the signature is wider than the dump
// says, passed straight through to the relocated prologue after the record call.

#include <stdint.h>

// Implemented in capture.zig. Runs on the game thread at level setup / teardown.
extern void capture_battle_awake(uint64_t self);
extern void capture_battle_destroy(uint64_t self);

// Set by capture.zig to the relocated-prologue stubs before each patch goes live.
uint64_t battle_hook_original_awake = 0;
uint64_t battle_hook_original_destroy = 0;

typedef void (*fn6)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t);

__attribute__((noinline)) void battle_hook_awake(uint64_t self, uint64_t a1, uint64_t a2,
                                                 uint64_t a3, uint64_t a4, uint64_t a5) {
    capture_battle_awake(self);
    fn6 original = (fn6)battle_hook_original_awake;
    if (original) original(self, a1, a2, a3, a4, a5);
}

__attribute__((noinline)) void battle_hook_destroy(uint64_t self, uint64_t a1, uint64_t a2,
                                                   uint64_t a3, uint64_t a4, uint64_t a5) {
    capture_battle_destroy(self);
    fn6 original = (fn6)battle_hook_original_destroy;
    if (original) original(self, a1, a2, a3, a4, a5);
}
