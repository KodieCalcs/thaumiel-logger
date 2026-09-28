/* Included by damage_probe.c: per-hit Daze gauge probe, CNBetaWin3.3.2 only.
 * Hooks the target's stun component be-hit handler GILABPBBMJH::JKAJPLNGPEK(PDOGBEADLIE) @ 0x1A4F76A0
 * (3.3.0: PHIPMJHEJBH::GOBDAKFLFKI @ 0x1B1B7BD0, 99.7% aligned). Traced 2026-09-18 from the saved
 * binary (docs/damage-probe-howto.md, "Per-hit Daze"): its caller has just run IKECLMLAAON, which
 * computes the hit's Daze from the result (Impact * (1 + bonus) * Daze MV ...), stores the target's
 * CurStun (BaseProperty 0xB) at this+0xD4 and CurStun + Daze at this+0xB0; this handler then calls
 * JCELMPFPFBH (applies the value to the property, writes the pre-clamp delta to result+0x250) and
 * stores the post-clamp delta CurStun_after - this+0xD4 to result+0x18C -- the Daze the gauge
 * actually received, which the result probe already snapshots. This probe adds the gauge state:
 * CurStun before the hit and the requested new value, plus the result pointer (ctx+0x30) as an
 * exact join key to the result rows (same thread; pooled result objects are reused, so the
 * decoder also requires the nearest elapsed_ms). MaxStun is not a plain field (a property lookup,
 * BaseProperty 0xC); at a stun onset CurStun_before + applied == MaxStun.
 * Same eight-push prologue as the snapshot probe (12 bytes, position independent). No game calls,
 * no writes to game objects; every read goes through the OS reader. */
uintptr_t damage_daze_original;
extern void damage_daze_entry(void);
static HANDLE daze_output = INVALID_HANDLE_VALUE;
static SRWLOCK daze_lock = SRWLOCK_INIT;
static volatile LONG daze_skipped;
static uint64_t daze_sequence;
/* CNBetaWin3.3.3: CDANMPBMFIJ::<obfuscated> @ 0x136ae770, located 2026-09-22 by structural class
 * match plus a 100% instruction-shape match over all 501 instructions (56-point gap). Offsets read
 * out of the instruction stream with tools/update/offsetdiff2.py.
 *
 * WATCH THE TARGET/BEFORE PAIR. 0xb0 exists in BOTH builds and means different things: in 3.3.2 it
 * is target_value, in 3.3.3 it is cur_before. Carrying the old constant over reads the wrong gauge
 * and never errors -- the exact reason these are taken from code, not from "the offset still exists". */
#define DAZE_RVA 0x15f83660 /* 3.3.3: 0x136ae770 CDANMPBMFIJ; matched 1.0 over 666 instructions */
#define DAZE_THIS_BYTES 0x100 /* FLDOPGOJDOP: covers every field this probe reads (max +0xf0) */
#define DAZE_CTX_BYTES 0x50 /* ctx: +0x30 result; attacker-id slot re-measured from first capture */
#define DAZE_CTX_RESULT 0x30 /* 3.3.3: 0x20. Confirmed twice: 4+ sites here, and the anomaly probe */
#define DAZE_THIS_ENTITY 0x58 /* 3.3.3: 0x60; unique field of the matched CAJPNCGFJEG type */
#define DAZE_THIS_TARGET 0xf0 /* float: CurStun + requested Daze (3.3.3: +0xb8; same-width movss witness) */
#define DAZE_THIS_BEFORE 0xe8 /* float: CurStun before the hit (3.3.3: +0xb0; the handler's subss witness) */
/* Join checks recovered from the hit-result factory stat copies, same method as 3.3.3. */
#define DAZE_RESULT_DAZE_MV 0x278
#define DAZE_RESULT_IMPACT 0x134
static const unsigned char daze_fingerprint[64] = {
    0x41,0x57,0x41,0x56,0x41,0x55,0x41,0x54,0x56,0x57,0x55,0x53,0x48,0x83,0xEC,0x58,
    0x0F,0x29,0x74,0x24,0x40,0x48,0x89,0xD7,0x48,0x89,0xCE,0x80,0x3D,0xA2,0x56,0x44,
    0xEF,0x00,0x0F,0x84,0x04,0x07,0x00,0x00,0x80,0x3D,0xA6,0x34,0xF7,0xEE,0x00,0x0F,
    0x85,0x15,0x07,0x00,0x00,0x48,0x8B,0x4E,0x38,0xE8,0xF2,0x03,0x6D,0x03,0x84,0xC0};
static const char *daze_header =
    "# schema=1 client=CNBetaWin3.3.4 target_rva=0x15f83660 (FLDOPGOJDOP, stun component be-hit handler) this=rcx ctx=rdx result_ptr=ctx+0x30 cur_before=this+0xe8 target_value=this+0xf0 join=result_ptr_same_thread_nearest_ms applied_daze=result+0x240_in_the_result_probe semantics=code_traced_3.3.4_join_checks\n"
    "sequence\telapsed_ms\tthread\tskipped\tcaller_rva\tthis\tctx\tresult_ptr\tentity_ptr\tcur_before\ttarget_value\tresult_daze_mv\tresult_impact"
    "\tthis_bytes\tthis_hex\tctx_bytes\tctx_hex\n";

static float daze_float(uintptr_t address) {
    float f = 0; unsigned char raw[4];
    if (snapshot(address, raw, 4) != 4) return -1.0f; /* unreadable: -1, impossible for a gauge value */
    memcpy(&f, raw, 4); return f;
}
void damage_daze_record(const ProbeRegisters *r, const uint64_t *entry_stack) {
    DWORD error = GetLastError();
    if (daze_output == INVALID_HANDLE_VALUE) { SetLastError(error); return; }
    if (!TryAcquireSRWLockExclusive(&daze_lock)) { InterlockedIncrement(&daze_skipped); SetLastError(error); return; }
    uint64_t caller = 0; snapshot((uintptr_t)entry_stack, &caller, sizeof(caller));
    uintptr_t self = r->gpr[0], ctx = r->gpr[1];
    uint64_t result_ptr = 0, entity_ptr = 0;
    if (ctx) snapshot(ctx + DAZE_CTX_RESULT, &result_ptr, 8);
    if (self) snapshot(self + DAZE_THIS_ENTITY, &entity_ptr, 8);
    float before = self ? daze_float(self + DAZE_THIS_BEFORE) : -1.0f, target = self ? daze_float(self + DAZE_THIS_TARGET) : -1.0f;
    /* A 0 offset means "not re-derived for this client", not "read at +0": reading the object
     * header would emit a plausible-looking float that is pure noise. */
    float daze_mv = (result_ptr && DAZE_RESULT_DAZE_MV) ? daze_float(result_ptr + DAZE_RESULT_DAZE_MV) : -1.0f,
          impact = (result_ptr && DAZE_RESULT_IMPACT) ? daze_float(result_ptr + DAZE_RESULT_IMPACT) : -1.0f;
    unsigned char self_bytes[DAZE_THIS_BYTES], ctx_bytes[DAZE_CTX_BYTES];
    SIZE_T n = self ? snapshot(self, self_bytes, sizeof(self_bytes)) : 0, m = ctx ? snapshot(ctx, ctx_bytes, sizeof(ctx_bytes)) : 0;
    static char line[1536]; char *p = line; /* < 1.1 KB: 0x150 bytes of hex + fixed cells */
    p += sprintf(p, "%llu\t%llu\t%lu\t%ld\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t%.9g\t%.9g\t%.9g\t%.9g",
        (unsigned long long)++daze_sequence, (unsigned long long)(GetTickCount64() - started), GetCurrentThreadId(), daze_skipped,
        (unsigned long long)(caller >= module_base ? caller - module_base : 0),
        (unsigned long long)self, (unsigned long long)ctx, (unsigned long long)result_ptr, (unsigned long long)entity_ptr,
        before, target, daze_mv, impact);
    p += sprintf(p, "\t%llu\t", (unsigned long long)n); p = result_hex(p, self_bytes, n);
    p += sprintf(p, "\t%llu\t", (unsigned long long)m); p = result_hex(p, ctx_bytes, m);
    *p++ = '\n';
    DWORD written = 0;
    if (!WriteFile(daze_output, line, (DWORD)(p - line), &written, NULL) || written != (DWORD)(p - line)) InterlockedIncrement(&daze_skipped);
    ReleaseSRWLockExclusive(&daze_lock); SetLastError(error);
}
static int daze_header_write(HANDLE h) { return put(h, daze_header); }

int damage_daze_start(void) {
    if (!module_base || !damage_probe_original) return -7;
    if (damage_daze_original) return -6;
    unsigned char *target = (unsigned char *)(module_base + DAZE_RVA);
    if (memcmp(target, daze_fingerprint, 64)) return -3;
    unsigned char *stub = VirtualAlloc(NULL, 26, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!stub) return -4;
    memcpy(stub, target, 12); /* eight pushes, no relative addressing */
    memcpy(stub + 12, "\xff\x25\0\0\0\0", 6);
    uintptr_t continuation = (uintptr_t)target + 12; memcpy(stub + 18, &continuation, 8);
    DWORD previous;
    if (!VirtualProtect(stub, 26, PAGE_EXECUTE_READ, &previous)) { VirtualFree(stub, 0, MEM_RELEASE); return -4; }
    FlushInstructionCache(GetCurrentProcess(), stub, 26);
    daze_output = probe_open("daze", daze_header_write);
    if (daze_output == INVALID_HANDLE_VALUE) { VirtualFree(stub, 0, MEM_RELEASE); return -5; }
    if (!VirtualProtect(target, 12, PAGE_EXECUTE_READWRITE, &previous)) {
        CloseHandle(daze_output); daze_output = INVALID_HANDLE_VALUE; VirtualFree(stub, 0, MEM_RELEASE); return -4;
    }
    damage_daze_original = (uintptr_t)stub;
    unsigned char patch[12] = {0x48, 0xb8}; uintptr_t entry = (uintptr_t)&damage_daze_entry;
    memcpy(patch + 2, &entry, 8); patch[10] = 0xff; patch[11] = 0xe0;
    memcpy(target, patch, 12); FlushInstructionCache(GetCurrentProcess(), target, 12);
    DWORD ignored; if (!VirtualProtect(target, 12, previous, &ignored)) return 2;
    return 1;
}
