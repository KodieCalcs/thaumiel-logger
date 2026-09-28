// Detour for the anim-event system's per-frame queue drain (3.3.2:
// EGMKKHDDOGE::AOGPOONJNGI, static void (CEODKDLMABB* component)).
//
// Same shape as hit_hook.c: declare the arity, pass everything through, tail into
// the relocated prologue. The function is static with one parameter, but we take
// the four register slots plus two stack slots so nothing is disturbed if the
// signature is wider than the dump says.

#include <stdint.h>

// Implemented in eventlog.zig. Runs on the game thread inside the frame loop.
extern void eventlog_record(uint64_t component);

// Set by eventlog.zig to the relocated-prologue stub before the patch goes live.
uint64_t event_hook_original = 0;

typedef void (*fn6)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t);

__attribute__((noinline)) void event_hook_dispatch(uint64_t component, uint64_t a1, uint64_t a2,
                                                   uint64_t a3, uint64_t a4, uint64_t a5) {
    eventlog_record(component);
    fn6 original = (fn6)event_hook_original;
    if (original) original(component, a1, a2, a3, a4, a5);
}
