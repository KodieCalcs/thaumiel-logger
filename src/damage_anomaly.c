/* Included by damage_probe.c: per-hit Anomaly Buildup gauge probe, CNBetaWin3.3.2 only.
 * Hooks the target's per-element anomaly gauge receiving a hit, PNNLDJHFOAO::BAIEOPOHGNL(HKMPLIFFNHO)
 * @ 0x19235B40 (traced 2026-09-18, docs/damage-probe-howto.md, "Per-hit Anomaly Buildup"). The gauge
 * object is one per (DamageElementType, EVariantElement) on the target's anomaly component
 * FCMJEGFPIDI (+0x78 DoubleKeyDictionary); every gauge receives every hit event and only the one whose
 * element (+0x70) matches the result's element accumulates: after = clamp(cur(+0x6c) + result+0xf8,
 * 0, max(+0x8c)); applied = after - cur is written to result+0x150 (so the result probe already carries
 * requested/applied); on fill it calls IPEBMFFAMNL (trigger). A hit refused by
 * JIDDJOHMOLF::ODJNEPMDHLA (element locked / anomaly state) leaves result+0x150 at 0. This probe adds
 * the gauge state per call: cur and max before the hit, element and variant, the owning entity, and
 * the result pointer (evt+0x20 = PDOGBEADLIE ctx, ctx+0x30 = result) as the join key to the result
 * rows (same thread; pooled result objects are reused, so the decoder also requires the nearest
 * elapsed_ms and checks the two result floats copied here). Rows = hits x gauges on the target.
 * Prologue: six pushes + sub rsp,0x78 = 12 bytes, position independent. No game calls, no writes to
 * game objects; every read goes through the OS reader. */
uintptr_t damage_anomaly_original;
extern void damage_anomaly_entry(void);
static HANDLE anomaly_output = INVALID_HANDLE_VALUE;
static SRWLOCK anomaly_lock = SRWLOCK_INIT;
static volatile LONG anomaly_skipped;
static uint64_t anomaly_sequence;
/* CNBetaWin3.3.3: GJCMIEECHCL::KHCLFLDGFJL(HEKCAINABCC), located 2026-09-22 by structural class
 * match (classmatch.py) plus a 100% instruction-shape match over all 52 instructions with a
 * 49-point gap to the runner-up. Field moves below were read out of the instruction stream
 * (tools/update/offsetdiff2.py), never inferred from the class layout -- that class reshuffles. */
#define ANOMALY_RVA 0x167e0190 /* 3.3.3: 0x1962ec60 GJCMIEECHCL::KHCLFLDGFJL; matched 1.0/548 */
#define ANOMALY_THIS_BYTES 0xa0 /* HEECCHMMMHJ instance fields end at +0x93 in the 3.3.4 dump too */
#define ANOMALY_EVT_CTX 0x20 /* UNCHANGED 3.3.3 -> 3.3.4: three aligned evt+0x20 derefs, byte-equal */
#define ANOMALY_CTX_BYTES 0x50 /* ctx: +0x30 result; attacker-id slot re-measured from first capture */
#define ANOMALY_CTX_RESULT 0x30 /* 3.3.3: 0x20. Confirmed twice: this probe's diff and the daze probe's */
#define ANOMALY_THIS_ENTITY 0x58 /* 3.3.3: 0x48; read+write pair in the 1.0-aligned handler */
#define ANOMALY_THIS_CUR 0x6c /* float: gauge before the hit (3.3.3: +0x7c) */
/* f68: byte-identical read at +0x84 in the 24-instruction max-gauge updater -- unchanged. */
#define ANOMALY_THIS_F68 0x84
#define ANOMALY_THIS_ELEMENT 0x78 /* int: DamageElementType (3.3.3: +0x68). Confirmed twice: the code
                                   * diff, and being the only DamageElementType field in the class */
#define ANOMALY_THIS_VARIANT 0x70 /* int: EVariantElement (3.3.3: +0x88 -- swapped with VARIANT2's slot) */
#define ANOMALY_THIS_VARIANT2 0x88 /* 3.3.3: +0x78; the swap is code-traced, both rows in the handler */
#define ANOMALY_THIS_MAX 0x74 /* float: gauge max (3.3.3: +0x80); also witnessed in the max updater */
/* Join checks recovered from the full gauge handler and hit-result factory. */
#define ANOMALY_RESULT_REQUESTED 0x1f0
#define ANOMALY_RESULT_DAZE_MV 0x278
static const unsigned char anomaly_fingerprint[64] = {
    0x41,0x57,0x41,0x56,0x56,0x57,0x55,0x53,0x48,0x83,0xEC,0x78,0x44,0x0F,0x29,0x44,
    0x24,0x60,0x0F,0x29,0x7C,0x24,0x50,0x0F,0x29,0x74,0x24,0x40,0x48,0x89,0xD7,0x48,
    0x89,0xCE,0x80,0x3D,0xA4,0xBD,0xBE,0xEE,0x00,0x0F,0x84,0x93,0x00,0x00,0x00,0x48,
    0xC7,0x44,0x24,0x28,0x00,0x00,0x00,0x00,0x80,0x3D,0xA3,0x8F,0x6E,0xEE,0x00,0x0F};
static const char *anomaly_header =
    "# schema=1 client=CNBetaWin3.3.4 target_rva=0x167e0190 (HEECCHMMMHJ::PLILBLPMLGE, per-element anomaly gauge receiving a hit) this=rcx evt=rdx ctx=evt+0x20 result_ptr=ctx+0x30 cur_before=this+0x6c max=this+0x74 element=this+0x78 join=result_ptr_same_thread_nearest_ms applied=result+0x174 requested=result+0x1f0 f68=this+0x84 semantics=code_traced_3.3.4_join_checks\n"
    "sequence\telapsed_ms\tthread\tskipped\tcaller_rva\tthis\tevt\tctx\tresult_ptr\tentity_ptr\telement\tvariant\tvariant2\tcur_before\tmax\tf68\tresult_requested\tresult_daze_mv"
    "\tthis_bytes\tthis_hex\tctx_bytes\tctx_hex\n";

static float anomaly_float(uintptr_t address) {
    float f = 0; unsigned char raw[4];
    if (snapshot(address, raw, 4) != 4) return -1.0f; /* unreadable: -1, impossible for a gauge value */
    memcpy(&f, raw, 4); return f;
}
static int32_t anomaly_int(uintptr_t address) {
    int32_t v = -1; unsigned char raw[4];
    if (snapshot(address, raw, 4) != 4) return -1;
    memcpy(&v, raw, 4); return v;
}
void damage_anomaly_record(const ProbeRegisters *r, const uint64_t *entry_stack) {
    DWORD error = GetLastError();
    if (anomaly_output == INVALID_HANDLE_VALUE) { SetLastError(error); return; }
    if (!TryAcquireSRWLockExclusive(&anomaly_lock)) { InterlockedIncrement(&anomaly_skipped); SetLastError(error); return; }
    uint64_t caller = 0; snapshot((uintptr_t)entry_stack, &caller, sizeof(caller));
    uintptr_t self = r->gpr[0], evt = r->gpr[1];
    uint64_t ctx = 0, result_ptr = 0, entity_ptr = 0;
    if (evt) snapshot(evt + ANOMALY_EVT_CTX, &ctx, 8);
    if (ctx) snapshot((uintptr_t)ctx + ANOMALY_CTX_RESULT, &result_ptr, 8);
    if (self) snapshot(self + ANOMALY_THIS_ENTITY, &entity_ptr, 8);
    int32_t element = self ? anomaly_int(self + ANOMALY_THIS_ELEMENT) : -1, variant = self ? anomaly_int(self + ANOMALY_THIS_VARIANT) : -1, variant2 = self ? anomaly_int(self + ANOMALY_THIS_VARIANT2) : -1;
    float cur = self ? anomaly_float(self + ANOMALY_THIS_CUR) : -1.0f, max = self ? anomaly_float(self + ANOMALY_THIS_MAX) : -1.0f, f68 = self ? anomaly_float(self + ANOMALY_THIS_F68) : -1.0f;
    /* A 0 offset means "not re-derived for this client" (see the defines), not "read at +0" --
     * reading the object header would emit a plausible-looking float that is pure noise. */
    float requested = (result_ptr && ANOMALY_RESULT_REQUESTED) ? anomaly_float((uintptr_t)result_ptr + ANOMALY_RESULT_REQUESTED) : -1.0f,
          daze_mv = (result_ptr && ANOMALY_RESULT_DAZE_MV) ? anomaly_float((uintptr_t)result_ptr + ANOMALY_RESULT_DAZE_MV) : -1.0f;
    unsigned char self_bytes[ANOMALY_THIS_BYTES], ctx_bytes[ANOMALY_CTX_BYTES];
    SIZE_T n = self ? snapshot(self, self_bytes, sizeof(self_bytes)) : 0, m = ctx ? snapshot((uintptr_t)ctx, ctx_bytes, sizeof(ctx_bytes)) : 0;
    static char line[1024]; char *p = line; /* < 0.7 KB: 0xf0 bytes of hex + fixed cells */
    p += sprintf(p, "%llu\t%llu\t%lu\t%ld\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t%ld\t%ld\t%ld\t%.9g\t%.9g\t%.9g\t%.9g\t%.9g",
        (unsigned long long)++anomaly_sequence, (unsigned long long)(GetTickCount64() - started), GetCurrentThreadId(), anomaly_skipped,
        (unsigned long long)(caller >= module_base ? caller - module_base : 0),
        (unsigned long long)self, (unsigned long long)evt, (unsigned long long)ctx, (unsigned long long)result_ptr, (unsigned long long)entity_ptr,
        (long)element, (long)variant, (long)variant2, cur, max, f68, requested, daze_mv);
    p += sprintf(p, "\t%llu\t", (unsigned long long)n); p = result_hex(p, self_bytes, n);
    p += sprintf(p, "\t%llu\t", (unsigned long long)m); p = result_hex(p, ctx_bytes, m);
    *p++ = '\n';
    DWORD written = 0;
    if (!WriteFile(anomaly_output, line, (DWORD)(p - line), &written, NULL) || written != (DWORD)(p - line)) InterlockedIncrement(&anomaly_skipped);
    ReleaseSRWLockExclusive(&anomaly_lock); SetLastError(error);
}
static int anomaly_header_write(HANDLE h) { return put(h, anomaly_header); }

int damage_anomaly_start(void) {
    if (!module_base || !damage_probe_original) return -7;
    if (damage_anomaly_original) return -6;
    unsigned char *target = (unsigned char *)(module_base + ANOMALY_RVA);
    if (memcmp(target, anomaly_fingerprint, 64)) return -3;
    unsigned char *stub = VirtualAlloc(NULL, 26, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!stub) return -4;
    memcpy(stub, target, 12); /* six pushes + sub rsp,0x78, no relative addressing */
    memcpy(stub + 12, "\xff\x25\0\0\0\0", 6);
    uintptr_t continuation = (uintptr_t)target + 12; memcpy(stub + 18, &continuation, 8);
    DWORD previous;
    if (!VirtualProtect(stub, 26, PAGE_EXECUTE_READ, &previous)) { VirtualFree(stub, 0, MEM_RELEASE); return -4; }
    FlushInstructionCache(GetCurrentProcess(), stub, 26);
    anomaly_output = probe_open("anomaly", anomaly_header_write);
    if (anomaly_output == INVALID_HANDLE_VALUE) { VirtualFree(stub, 0, MEM_RELEASE); return -5; }
    if (!VirtualProtect(target, 12, PAGE_EXECUTE_READWRITE, &previous)) {
        CloseHandle(anomaly_output); anomaly_output = INVALID_HANDLE_VALUE; VirtualFree(stub, 0, MEM_RELEASE); return -4;
    }
    damage_anomaly_original = (uintptr_t)stub;
    unsigned char patch[12] = {0x48, 0xb8}; uintptr_t entry = (uintptr_t)&damage_anomaly_entry;
    memcpy(patch + 2, &entry, 8); patch[10] = 0xff; patch[11] = 0xe0;
    memcpy(target, patch, 12); FlushInstructionCache(GetCurrentProcess(), target, 12);
    DWORD ignored; if (!VirtualProtect(target, 12, previous, &ignored)) return 2;
    return 1;
}
