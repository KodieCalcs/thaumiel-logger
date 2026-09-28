/* Included by damage_probe.c: per-hit attacker snapshot, CNBetaWin3.3.0 only.
 * 3.3.2: GOOCOICILAJ::KAFEKGEDAAI @ 0x133C7BF0 (same shape, 1410 vs 1409 instructions, 99.5%
 * aligned); the traced copies below are now rcx+0x194 -> result+0x23C (ATK), rcx+0xF8 -> +0x144
 * (Daze MV), rcx+0x1C0 -> +0x1D4 (level); every offset moved, see docs/client-update-playbook.md.
 * 3.3.0: hooks the hit-result factory JJNCFKMGDDP::PCLAJDPJJMN @ 0x16FA7460 (static, 7 params:
 * rcx = KJFAPLPNFON snapshot (class 0x500059EE3A8 in the v6 dump), edx, r8d, r9 = per-attack
 * object, [rsp+0x28] = HPGPGOBHHFK (becomes result+0xA8), [rsp+0x30] (becomes result+0xDC),
 * [rsp+0x38], [rsp+0x40] = MethodInfo). Traced 2026-09-12 from the saved binary: this function
 * obtains the pooled result (call 0x167968B0) and copies rcx+0x130 -> result+0x180 (ATK),
 * rcx+0x68 -> +0x1BC (Impact), rcx+0x164 -> +0x25C (AP), rcx+0x180 -> +0x238 (AM),
 * rcx+0xB8 -> +0x164 (Daze MV), rcx+0x1B0 -> +0x1B4 (level), and feeds several rcx fields into
 * the named-modifier dictionary via LBCELJNJAIK::KEOAKNJKFPL @ 0x16795C50. The result does not
 * keep a pointer to the snapshot, so it must be read here, at factory entry, before conversion.
 * Same eight-push prologue as the string probe (12 bytes, position independent).
 * No game calls, no writes to game objects; snapshots use the OS reader. Field semantics beyond
 * the copies above are NOT labelled until a capture pairs rows with the result probe. */
uintptr_t damage_snapshot_original;
extern void damage_snapshot_entry(void);
static HANDLE snapshot_output = INVALID_HANDLE_VALUE;
static SRWLOCK snapshot_lock = SRWLOCK_INIT;
static volatile LONG snapshot_skipped;
static uint64_t snapshot_sequence;
/* CNBetaWin3.3.4: ONBKKHGOGDE::NDPEJBBAFPC/7 (3.3.3: 0x1b64a750 in GFNGNPNAJHE). Located
 * 2026-09-25: structural class match (one candidate) plus a 99.86% instruction-shape match over
 * 1408 instructions (exact same count; runner-up 0.47). Its 64-byte fingerprint is unchanged
 * from 3.3.3 -- the third build in a row this function's head has been byte-stable. */
#define SNAPSHOT_RVA 0x1bfc5500 /* 3.3.3: 0x1b64a750; 3.3.2: 0x133c7bf0 */
#define SNAPSHOT_BYTES 0x200 /* source-object reads still end at +0x1E4 in the 3.3.4 factory body */
#define SNAPSHOT_ARG4_BYTES 0x190 /* r9 object: fields read up to +0x17c in the 3.3.4 factory */
static const unsigned char snapshot_fingerprint[64] = {
    0x41,0x57,0x41,0x56,0x41,0x55,0x41,0x54,0x56,0x57,0x55,0x53,0x48,0x81,0xec,0xb8,
    0x00,0x00,0x00,0x44,0x0f,0x29,0x8c,0x24,0xa0,0x00,0x00,0x00,0x44,0x0f,0x29,0x84,
    0x24,0x90,0x00,0x00,0x00,0x0f,0x29,0xbc,0x24,0x80,0x00,0x00,0x00,0x0f,0x29,0x74,
    0x24,0x70,0x4d,0x89,0xcd,0x44,0x89,0xc7,0x89,0x54,0x24,0x44,0x48,0x89,0xcb,0x80};
static const char *snapshot_header =
    "# schema=1 client=CNBetaWin3.3.4 target_rva=0x1bfc5500 (ONBKKHGOGDE, hit-result factory) snapshot=rcx first_0x200 arg4=r9 first_0x190 join=same_thread_order_then_snapshot+0x188==result+0x110_and_snapshot+0x1a4==result+0x278 semantics=unlabeled_except_traced_copies\n"
    "sequence\telapsed_ms\tthread\tskipped\tcaller_rva\tsnapshot_ptr\targ2\targ3\targ4_ptr\targ5_ptr\targ6_ptr\targ7\tmethod"
    "\tsnapshot_bytes\tsnapshot_hex\targ4_bytes\targ4_hex\n";

void damage_snapshot_record(const ProbeRegisters *r, const uint64_t *entry_stack) {
    DWORD error = GetLastError();
    if (snapshot_output == INVALID_HANDLE_VALUE) { SetLastError(error); return; }
    if (!TryAcquireSRWLockExclusive(&snapshot_lock)) { InterlockedIncrement(&snapshot_skipped); SetLastError(error); return; }
    uint64_t stack[9]; snapshot((uintptr_t)entry_stack, stack, sizeof(stack));
    unsigned char snap[SNAPSHOT_BYTES], arg4[SNAPSHOT_ARG4_BYTES];
    SIZE_T n = snapshot(r->gpr[0], snap, sizeof(snap)), m = snapshot(r->gpr[3], arg4, sizeof(arg4));
    static char line[4096]; char *p = line; /* < 2.1 KB: 0x390 bytes of hex + fixed cells */
    p += sprintf(p, "%llu\t%llu\t%lu\t%ld\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx",
        (unsigned long long)++snapshot_sequence, (unsigned long long)(GetTickCount64() - started), GetCurrentThreadId(), snapshot_skipped,
        (unsigned long long)(stack[0] >= module_base ? stack[0] - module_base : 0),
        (unsigned long long)r->gpr[0], (unsigned long long)r->gpr[1], (unsigned long long)r->gpr[2], (unsigned long long)r->gpr[3],
        (unsigned long long)stack[5], (unsigned long long)stack[6], (unsigned long long)stack[7], (unsigned long long)stack[8]);
    p += sprintf(p, "\t%llu\t", (unsigned long long)n); p = result_hex(p, snap, n);
    p += sprintf(p, "\t%llu\t", (unsigned long long)m); p = result_hex(p, arg4, m);
    *p++ = '\n';
    DWORD written = 0;
    if (!WriteFile(snapshot_output, line, (DWORD)(p - line), &written, NULL) || written != (DWORD)(p - line)) InterlockedIncrement(&snapshot_skipped);
    ReleaseSRWLockExclusive(&snapshot_lock); SetLastError(error);
}
static int snapshot_header_write(HANDLE h) { return put(h, snapshot_header); }

int damage_snapshot_start(void) {
    if (!module_base || !damage_probe_original) return -7;
    if (damage_snapshot_original) return -6;
    unsigned char *target = (unsigned char *)(module_base + SNAPSHOT_RVA);
    if (memcmp(target, snapshot_fingerprint, 64)) return -3;
    unsigned char *stub = VirtualAlloc(NULL, 26, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!stub) return -4;
    memcpy(stub, target, 12); /* eight pushes, no relative addressing */
    memcpy(stub + 12, "\xff\x25\0\0\0\0", 6);
    uintptr_t continuation = (uintptr_t)target + 12; memcpy(stub + 18, &continuation, 8);
    DWORD previous;
    if (!VirtualProtect(stub, 26, PAGE_EXECUTE_READ, &previous)) { VirtualFree(stub, 0, MEM_RELEASE); return -4; }
    FlushInstructionCache(GetCurrentProcess(), stub, 26);
    snapshot_output = probe_open("snapshot", snapshot_header_write);
    if (snapshot_output == INVALID_HANDLE_VALUE) { VirtualFree(stub, 0, MEM_RELEASE); return -5; }
    if (!VirtualProtect(target, 12, PAGE_EXECUTE_READWRITE, &previous)) {
        CloseHandle(snapshot_output); snapshot_output = INVALID_HANDLE_VALUE; VirtualFree(stub, 0, MEM_RELEASE); return -4;
    }
    damage_snapshot_original = (uintptr_t)stub;
    unsigned char patch[12] = {0x48, 0xb8}; uintptr_t entry = (uintptr_t)&damage_snapshot_entry;
    memcpy(patch + 2, &entry, 8); patch[10] = 0xff; patch[11] = 0xe0;
    memcpy(target, patch, 12); FlushInstructionCache(GetCurrentProcess(), target, 12);
    DWORD ignored; if (!VirtualProtect(target, 12, previous, &ignored)) return 2;
    return 1;
}
