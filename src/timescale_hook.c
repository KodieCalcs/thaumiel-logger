// Detour for the level time manager's per-frame step (timescalelog.zig): 3.3.2
// `LOLPDHOFIHG::Update(float dt)`, the one place the global time scale is applied.
//
// Unlike hit_hook.c / event_hook.c this is a POST-call detour: the original runs first,
// then the record call reads the fields it just wrote (the scale it multiplied dt by and
// the world time it accumulated). The Win64 ABI puts a float second argument in xmm1 and
// leaves rdx unused, so declaring `float dt` reproduces the il2cpp signature
// `void (this, float, MethodInfo*)` exactly: rcx, xmm1, r8 (r9 is taken along untouched).

#include <stdint.h>

// Implemented in timescalelog.zig. Runs on the game thread once per frame, after the step.
extern void timescalelog_record(uint64_t self, float dt);

// Set by timescalelog.zig to the relocated-prologue stub before the patch goes live.
uint64_t timescale_hook_original = 0;

typedef void (*fn_update)(uint64_t, float, uint64_t, uint64_t);

__attribute__((noinline)) void timescale_hook_update(uint64_t self, float dt, uint64_t method,
                                                     uint64_t a3) {
    fn_update original = (fn_update)timescale_hook_original;
    if (original) original(self, dt, method, a3);
    timescalelog_record(self, dt);
}
