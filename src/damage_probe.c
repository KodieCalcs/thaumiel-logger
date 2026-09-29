/* Experimental damage-text INPUT probe, CNBetaWin3.3.0 only.
 * No field is called damage/crit/owner until a capture establishes its meaning.
 * On unless damage-probe-disable.txt is beside the launcher (working directory).
 * Installed during existing startup patching, before combat threads use this UI.
 */
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stddef.h>
#include "pins.h" /* generated: tools/update/rederive.py emit */

typedef struct {
    uint64_t gpr[7]; /* rcx rdx r8 r9 rax r10 r11 */
    uint64_t padding;
    uint64_t xmm[6][2];
} ProbeRegisters;
_Static_assert(offsetof(ProbeRegisters, xmm) == 64, "assembly layout");

uintptr_t damage_probe_original;
extern void damage_probe_entry(void);
uintptr_t damage_numeric_original;
extern void damage_numeric_entry(void);
static HANDLE output = INVALID_HANDLE_VALUE;
static SRWLOCK output_lock = SRWLOCK_INIT;
static volatile LONG skipped;
static uintptr_t module_base;
static ULONGLONG started;
static uint64_t sequence;
/* One process-wide row order, the last `order` column of state.tsv and of the damage-result /
 * -snapshot / -daze / -anomaly probes. elapsed_ms is GetTickCount64 (~16 ms steps) and each file
 * has its own sequence, so rows of different files in one tick could not be ordered: the hit that
 * fills the Daze gauge and the Stun it starts share a millisecond. Taken at hook entry, on the
 * calling thread; statelog.zig calls it for its rows. */
static volatile LONG64 log_order;
uint64_t thaumiel_log_next_order(void) { return (uint64_t)InterlockedIncrement64(&log_order); }

static HANDLE numeric_output = INVALID_HANDLE_VALUE;
static SRWLOCK numeric_lock = SRWLOCK_INIT;
static volatile LONG numeric_skipped;
static uint64_t numeric_sequence;

static void write_line(const char *line) {
    DWORD done;
    if (!WriteFile(output, line, (DWORD)strlen(line), &done, NULL))
        InterlockedIncrement(&skipped);
}

/* ---- capture layout (capture.zig) ---------------------------------------------------------------
 * Every probe file opens in the current battle folder and is reopened there on each battle awake
 * (damage_probe_rotate); the status file lives in the session folder. Both prefixes end in a
 * backslash and default to "" = the working directory, which is what the tests use. */
static char probe_session_dir[MAX_PATH];
static char probe_battle_dir[MAX_PATH];

void damage_probe_set_dirs(const char *session_dir, const char *battle_dir) {
    snprintf(probe_session_dir, sizeof(probe_session_dir), "%s", session_dir ? session_dir : "");
    snprintf(probe_battle_dir, sizeof(probe_battle_dir), "%s", battle_dir ? battle_dir : "");
}

static int put(HANDLE h, const char *text) {
    DWORD written = 0; size_t n = strlen(text);
    return WriteFile(h, text, (DWORD)n, &written, NULL) && written == n;
}

/* Open `<battle dir>damage-<name>-<UTC stamp>-<pid>.tsv` and write its header through
 * `header` (1 = ok). INVALID_HANDLE_VALUE when the file or the header fails. */
static HANDLE probe_open(const char *name, int (*header)(HANDLE)) {
    char path[MAX_PATH + 96]; SYSTEMTIME now; GetSystemTime(&now);
    snprintf(path, sizeof(path), "%sdamage-%s-%04u%02u%02u-%02u%02u%02u-%lu.tsv", probe_battle_dir, name,
        now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond, GetCurrentProcessId());
    HANDLE h = CreateFileA(path, GENERIC_WRITE, FILE_SHARE_READ, NULL, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return h;
    if (header && !header(h)) { CloseHandle(h); return INVALID_HANDLE_VALUE; }
    return h;
}

/* Rotate one probe's file under its lock: the hooks only TryAcquire, so they skip (and count)
 * rather than block while the handle is swapped. A probe that never installed stays closed. */
static void probe_reopen(HANDLE *out, SRWLOCK *lock, const char *name, int (*header)(HANDLE)) {
    AcquireSRWLockExclusive(lock);
    if (*out != INVALID_HANDLE_VALUE) {
        FlushFileBuffers(*out); CloseHandle(*out);
        *out = probe_open(name, header);
    }
    ReleaseSRWLockExclusive(lock);
}

static void probe_flush(HANDLE *out, SRWLOCK *lock) {
    AcquireSRWLockExclusive(lock);
    if (*out != INVALID_HANDLE_VALUE) FlushFileBuffers(*out);
    ReleaseSRWLockExclusive(lock);
}

/* Only copy bounded memory using the OS reader: unknown arguments are never dereferenced.
 * Partial/unreadable snapshots are explicitly marked by their byte count. */
static SIZE_T snapshot(uintptr_t address, void *dest, SIZE_T bytes) {
    SIZE_T copied = 0;
    memset(dest, 0, bytes);
    if (address) ReadProcessMemory(GetCurrentProcess(), (void *)address, dest, bytes, &copied);
    return copied;
}

/* Executable sections of GameAssembly (.text = libil2cpp runtime, il2cpp = game code), read
 * from the PE section table once at install. Used to classify stack words as return addresses. */
static struct { uintptr_t lo, hi; } exec_ranges[8];
static int exec_count;

static void load_exec_ranges(void) {
    const IMAGE_DOS_HEADER *dos = (const IMAGE_DOS_HEADER *)module_base;
    const IMAGE_NT_HEADERS64 *pe = (const IMAGE_NT_HEADERS64 *)(module_base + dos->e_lfanew);
    const IMAGE_SECTION_HEADER *sec = IMAGE_FIRST_SECTION(pe);
    exec_count = 0;
    for (int i = 0; i < pe->FileHeader.NumberOfSections && exec_count < 8; i++) {
        if (!(sec[i].Characteristics & IMAGE_SCN_MEM_EXECUTE)) continue;
        exec_ranges[exec_count].lo = module_base + sec[i].VirtualAddress;
        exec_ranges[exec_count].hi = module_base + sec[i].VirtualAddress + sec[i].Misc.VirtualSize;
        exec_count++;
    }
}

static int in_exec(uintptr_t a) {
    for (int i = 0; i < exec_count; i++) if (a >= exec_ranges[i].lo && a < exec_ranges[i].hi) return 1;
    return 0;
}

/* A stack word is a plausible return address when it lands in executable code AND the bytes
 * just before it encode a call. b[0..7] are the eight bytes at a-8..a-1.
 *   E8 rel32            at a-5  -> b[3]
 *   FF 15 disp32        at a-6  -> b[2],b[3]        call [rip+disp32]
 *   FF 9x disp32        at a-6  -> b[2],b[3]        call [reg+disp32]
 *   FF 5x disp8         at a-3  -> b[5],b[6]        call [reg+disp8]
 *   FF 1x / FF Dx       at a-2  -> b[6],b[7]        call [reg] / call reg
 *   41 FF 1x / 41 FF Dx at a-3  -> b[5],b[6],b[7]   same with r8-r15
 * Data pointers into code (vtables, method pointers) fail the call check. */
static int looks_like_return(uintptr_t a) {
    unsigned char b[8];
    if (!in_exec(a)) return 0;
    if (snapshot(a - 8, b, sizeof(b)) != sizeof(b)) return 0;
    if (b[3] == 0xE8) return 1;
    if (b[2] == 0xFF && (b[3] == 0x15 || (b[3] & 0xF8) == 0x90)) return 1;
    if (b[5] == 0xFF && (b[6] & 0xF8) == 0x50) return 1;
    if (b[6] == 0xFF && ((b[7] & 0xF8) == 0x10 || (b[7] & 0xF8) == 0xD0)) return 1;
    if (b[5] == 0x41 && b[6] == 0xFF && ((b[7] & 0xF8) == 0x10 || (b[7] & 0xF8) == 0xD0)) return 1;
    return 0;
}

/* Scan the caller's stack above the hook entry for return addresses. entry_stack[0] is the
 * return into the immediate caller; words above it are that caller's frame, its caller's, and so
 * on. No frame pointers are assumed: every word is tested. Bounded, read-only, OS-mediated. */
#define SCAN_WORDS 512
#define RAW_WORDS 384   /* 3 KB of raw stack per damage event, for the offline unwind */
#include "damage_result.c" /* 3.3.3 join-check refresh: rebuild included probes */ /* result probe schema 5 (lean a8 strings, + attack tag list, + stat dictionaries and per-hit stat reads 2026-09-28); NOTE: zig's cache does not track this include -- touch this line to force a rebuild after editing it */
#include "damage_snapshot.c" /* hit-result factory / attacker snapshot probe schema 1; same cache caveat */
#include "damage_daze.c" /* stun-component be-hit handler / Daze gauge probe schema 1; same cache caveat (header verified 2026-09-18) */
#include "damage_anomaly.c" /* per-element anomaly gauge receive / Anomaly Buildup gauge probe schema 1; same cache caveat */
#define RET_MAX 16
typedef struct { uint16_t index; uint32_t rva; } ReturnHit;
static int scan_returns(const uint64_t *entry_stack, ReturnHit *out) {
    int n = 0;
    for (int i = 0; i < SCAN_WORDS && n < RET_MAX; i++) {
        uint64_t word;
        if (snapshot((uintptr_t)(entry_stack + i), &word, sizeof(word)) != sizeof(word)) break;
        if (!looks_like_return((uintptr_t)word)) continue;
        out[n].index = (uint16_t)i;
        out[n].rva = (uint32_t)(word - module_base);
        n++;
    }
    return n;
}

void damage_probe_record(const ProbeRegisters *r, const uint64_t *entry_stack) {
    DWORD last_error = GetLastError();
    if (output == INVALID_HANDLE_VALUE || !TryAcquireSRWLockExclusive(&output_lock)) {
        InterlockedIncrement(&skipped);
        SetLastError(last_error);
        return;
    }
    uint64_t stack[14], pointed[8];
    SIZE_T stack_bytes = snapshot((uintptr_t)entry_stack + 40, stack, sizeof(stack));
    SIZE_T pointed_bytes = snapshot(r->gpr[1], pointed, sizeof(pointed));
    uintptr_t caller = (uintptr_t)*entry_stack;
    char line[8192]; /* schema 2 rows are ~1.3 KB */
    int n = snprintf(line, sizeof(line), "%llu\t%llu\t%lu\t%ld\t0x%llx\t0x%llx\t%zu\t%zu",
        (unsigned long long)++sequence, (unsigned long long)(GetTickCount64()-started),
        GetCurrentThreadId(), InterlockedCompareExchange(&skipped,0,0),
        (unsigned long long)caller,
        (unsigned long long)((caller >= module_base && caller < module_base+0x21396000)
            ? caller-module_base : 0), stack_bytes, pointed_bytes);
    for (int i=0;i<4;i++) n += snprintf(line+n,sizeof(line)-n,"\t0x%016llx",(unsigned long long)r->gpr[i]);
    for (int i=0;i<14;i++) n += snprintf(line+n,sizeof(line)-n,"\t0x%016llx",(unsigned long long)stack[i]);
    for (int i=0;i<6;i++) for(int j=0;j<2;j++)
        n += snprintf(line+n,sizeof(line)-n,"\t0x%016llx",(unsigned long long)r->xmm[i][j]);
    for (int i=0;i<8;i++) n += snprintf(line+n,sizeof(line)-n,"\t0x%016llx",(unsigned long long)pointed[i]);
    /* schema 2: p12 (declared CMCIBGLJJCO, stack slot 9) snapshot, then return addresses found
     * on the stack above the entry, shallowest first, as stack_index:rva. */
    uint64_t p12[16] = {0};
    SIZE_T p12_bytes = (stack_bytes >= 80) ? snapshot(stack[9], p12, sizeof(p12)) : 0;
    n += snprintf(line+n,sizeof(line)-n,"\t%zu",p12_bytes);
    for (int i=0;i<16;i++) n += snprintf(line+n,sizeof(line)-n,"\t0x%016llx",(unsigned long long)p12[i]);
    ReturnHit rets[RET_MAX];
    int ret_count = scan_returns(entry_stack, rets);
    n += snprintf(line+n,sizeof(line)-n,"\t%d",ret_count);
    for (int i=0;i<RET_MAX;i++) {
        if (i < ret_count) n += snprintf(line+n,sizeof(line)-n,"\t%u:0x%x",(unsigned)rets[i].index,(unsigned)rets[i].rva);
        else n += snprintf(line+n,sizeof(line)-n,"\t");
    }
    snprintf(line+n,sizeof(line)-n,"\n");
    write_line(line); /* Write each event; no fflush threshold can hide a short test. */
    ReleaseSRWLockExclusive(&output_lock);
    SetLastError(last_error);
}

/* PNDODKIKGNA(float, IFMEFPGOMNF, float), instance method, returns void.
 * Fresh v7 metadata + saved binary confirm XMM1=input, R8d=enum, XMM3=auxiliary.
 * Normal path adds input (with an upper clamp) to self+0x2c. Log BEFORE mutation.
 * These are UI update inputs; per-hit completeness/aggregation needs live validation.
 */
void damage_numeric_record(const ProbeRegisters *r, const uint64_t *entry_stack) {
    DWORD last_error = GetLastError();
    if (numeric_output == INVALID_HANDLE_VALUE || !TryAcquireSRWLockExclusive(&numeric_lock)) {
        InterlockedIncrement(&numeric_skipped);
        SetLastError(last_error);
        return;
    }
    uint64_t object[8];
    SIZE_T object_bytes = snapshot(r->gpr[0], object, sizeof(object));
    float input, auxiliary, prior = 0;
    memcpy(&input, &r->xmm[1][0], 4);
    memcpy(&auxiliary, &r->xmm[3][0], 4);
    if (object_bytes >= 0x30) memcpy(&prior, (unsigned char *)object + 0x2c, 4);
    uintptr_t caller = (uintptr_t)*entry_stack;
    char line[2048];
    int n = snprintf(line, sizeof(line), "%llu\t%llu\t%lu\t%ld\t0x%llx\t0x%llx\t0x%llx\t%.9g\t0x%08lx\t%lu\t%.9g\t%.9g\t%zu",
        (unsigned long long)++numeric_sequence, (unsigned long long)(GetTickCount64()-started),
        GetCurrentThreadId(), InterlockedCompareExchange(&numeric_skipped,0,0),
        (unsigned long long)caller,
        (unsigned long long)((caller >= module_base && caller < module_base+0x21396000) ? caller-module_base : 0),
        (unsigned long long)r->gpr[0], (double)input, (unsigned long)(uint32_t)r->xmm[1][0],
        (unsigned long)(uint32_t)r->gpr[2], (double)auxiliary, (double)prior, object_bytes);
    for(int i=0;i<8;i++) n += snprintf(line+n,sizeof(line)-n,"\t0x%016llx",(unsigned long long)object[i]);
    snprintf(line+n,sizeof(line)-n,"\n");
    DWORD written=0;
    if(!WriteFile(numeric_output,line,(DWORD)strlen(line),&written,NULL) || written != strlen(line))
        InterlockedIncrement(&numeric_skipped);
    ReleaseSRWLockExclusive(&numeric_lock);
    SetLastError(last_error);
}

/* 16 whole, position-independent prologue bytes: push rsi; push rdi; sub rsp,58h;
 * save xmm7 at rsp+40h; save xmm6 at rsp+30h. Never use the old 12-byte boundary. */
static const unsigned char numeric_fingerprint[64] = {
    0x56,0x57,0x48,0x83,0xec,0x58,0x0f,0x29,0x7c,0x24,0x40,0x0f,0x29,0x74,0x24,0x30,
    0x0f,0x28,0xf3,0x44,0x89,0xc7,0x0f,0x28,0xf9,0x48,0x89,0xce,0x80,0x3d,0x85,0x38,
    0xd2,0xed,0x00,0x0f,0x85,0x07,0x01,0x00,0x00,0xf3,0x0f,0x10,0x05,0x1f,0x88,0x48,
    0xeb,0x0f,0x28,0xc8,0xf3,0x0f,0x5d,0xcf,0xf3,0x0f,0x58,0x4e,0x44,0xf3,0x0f,0x5d
};

/* Called only after the original string probe validates the PE identity and installs.
 * Its clock is shared, but streams/counters are separate. Refusal leaves the string hook intact.
 */
static int numeric_header_write(HANDLE h){
    return put(h,"# schema=1 client=CNBetaWin3.3.2 target_rva=0x17184100 clock=shared_with_string_probe values=UI_accumulator_inputs\n"
        "sequence\telapsed_ms\tthread\tskipped\tcaller\tcaller_rva\titem\tinput_value\tinput_bits\tcategory_raw\taux_value\tprior_accumulator\tobject_bytes"
        "\titem_mem0\titem_mem1\titem_mem2\titem_mem3\titem_mem4\titem_mem5\titem_mem6\titem_mem7\n");
}

int damage_numeric_start(void) {
    if(!module_base || !damage_probe_original) return -7;
    if(damage_numeric_original) return -6;
    unsigned char *target=(unsigned char *)(module_base+0x17184100);
    if(memcmp(target,numeric_fingerprint,sizeof(numeric_fingerprint))) return -3;
    unsigned char *stub=VirtualAlloc(NULL,30,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);
    if(!stub) return -4;
    memcpy(stub,target,16);
    memcpy(stub+16,"\xff\x25\0\0\0\0",6);
    uintptr_t continuation=(uintptr_t)target+16;
    memcpy(stub+22,&continuation,8);
    DWORD previous;
    if(!VirtualProtect(stub,30,PAGE_EXECUTE_READ,&previous)){VirtualFree(stub,0,MEM_RELEASE);return -4;}
    FlushInstructionCache(GetCurrentProcess(),stub,30);
    numeric_output=probe_open("numeric",numeric_header_write);
    if(numeric_output==INVALID_HANDLE_VALUE){VirtualFree(stub,0,MEM_RELEASE);return -5;}
    if(!VirtualProtect(target,16,PAGE_EXECUTE_READWRITE,&previous)){
        CloseHandle(numeric_output);numeric_output=INVALID_HANDLE_VALUE;VirtualFree(stub,0,MEM_RELEASE);return -4;
    }
    damage_numeric_original=(uintptr_t)stub;
    unsigned char patch[16]={0x48,0xb8};uintptr_t entry=(uintptr_t)&damage_numeric_entry;
    memcpy(patch+2,&entry,8);patch[10]=0xff;patch[11]=0xe0;memset(patch+12,0x90,4);
    memcpy(target,patch,16);FlushInstructionCache(GetCurrentProcess(),target,16);
    DWORD ignored;
    if(!VirtualProtect(target,16,previous,&ignored))return 2;
    return 1;
}

/* ---- damage-display EVENT probe -------------------------------------------------------------
 * UIInLevelDamageTextContainerChildWindowController::HBIMAECOHPC(AGLNJHOEMAL&, Battle.Entity,
 * HNNMFCJLDHF, Vector3) at 0x1482D830: the handler the combat engine's damage-display event
 * lands in, one call per displayed number, upstream of every string/numeric path. rdx points at
 * the event struct; the v7 dump's field offsets for AGLNJHOEMAL are rdx-offset + 0x10:
 *   dump 0x10 u32, 0x14 u32, 0x18 EntityHandle(16), 0x28 EntityType, 0x2C Vector3, 0x38 Vector3,
 *   0x44 float, 0x48 OGDEPEKFALC, 0x4C bool, 0x50 DamageElementType, 0x54 bool, 0x58 IGHLBPEDELJ,
 *   0x5C float, 0x60 SpecialDamageTextType, 0x64..0x6C bools, 0x6D LEIJMKINAHL, 0x70 float,
 *   0x74 i32, 0x78 bool.   (Established from the handler reading [rdx+0x40] as the element.)
 * Nothing here is named damage/attacker/skill until a capture shows it. */
uintptr_t damage_event_original;
extern void damage_event_entry(void);
static HANDLE event_output = INVALID_HANDLE_VALUE;
static SRWLOCK event_lock = SRWLOCK_INIT;
static volatile LONG event_skipped;
static uint64_t event_sequence;

/* Enqueue-side hook: FHJJBJLAPCN::JJDHHPGOMMD(AGLNJHOEMAL&) at 0x142ACFF0 -- the static method the
 * combat engine calls to queue a damage-display event at hit time (the UI drains the queue later
 * in OnUpdateText; see the unwind in damage-probe-howto.md). Same struct, at rcx. Its return
 * address is the publisher, and the raw stack is the combat stack at the moment of the hit. */
uintptr_t damage_enqueue_original;
extern void damage_enqueue_entry(void);
static HANDLE enqueue_output = INVALID_HANDLE_VALUE;
static SRWLOCK enqueue_lock = SRWLOCK_INIT;
static volatile LONG enqueue_skipped;
static uint64_t enqueue_sequence;
static const unsigned char enqueue_fingerprint[64] = {
    0x56,0x48,0x81,0xec,0x90,0x00,0x00,0x00,0x48,0x89,0xce,0x80,0x3d,0xf5,0x7c,0xf7,
    0xf1,0x00,0x0f,0x84,0x90,0x00,0x00,0x00,0x80,0x3d,0x7e,0x3e,0xa9,0xf1,0x00,0x0f,
    0x85,0xa1,0x00,0x00,0x00,0x48,0x8b,0x0d,0x74,0x8b,0xb5,0xf1,0x80,0xb9,0xcb,0x00,
    0x00,0x00,0x00,0x0f,0x84,0xaf,0x00,0x00,0x00,0x48,0x8b,0x05,0xd8,0x31,0xaf,0xf1};

static const unsigned char event_fingerprint[64] = {
    0x41,0x57,0x41,0x56,0x41,0x55,0x41,0x54,0x56,0x57,0x55,0x53,0x48,0x81,0xec,0x58,
    0x01,0x00,0x00,0x0f,0x29,0xb4,0x24,0x40,0x01,0x00,0x00,0x4d,0x89,0xce,0x4d,0x89,
    0xc4,0x48,0x89,0xd3,0x48,0x89,0xce,0x48,0x8b,0xac,0x24,0xc0,0x01,0x00,0x00,0x80,
    0x3d,0xd3,0x85,0x82,0xf0,0x00,0x0f,0x84,0xbf,0x02,0x00,0x00,0x48,0xc7,0x84,0x24};

/* Pure readers over the event snapshot, addressed by DUMP offset (snapshot starts at dump 0x10). */
static unsigned long      ev_u32(const unsigned char *ev, int off) { uint32_t v; memcpy(&v, ev + off - 0x10, 4); return (unsigned long)v; }
static long               ev_i32(const unsigned char *ev, int off) { int32_t v;  memcpy(&v, ev + off - 0x10, 4); return (long)v; }
static double             ev_f32(const unsigned char *ev, int off) { float v;    memcpy(&v, ev + off - 0x10, 4); return (double)v; }
static unsigned long long ev_u64(const unsigned char *ev, int off) { uint64_t v; memcpy(&v, ev + off - 0x10, 8); return (unsigned long long)v; }
static unsigned           ev_b8 (const unsigned char *ev, int off) { return (unsigned)ev[off - 0x10]; }

/* Shared row writer for both struct-carrying hooks. ev_ptr is the AGLNJHOEMAL address (rdx for
 * the UI handler, rcx for the enqueue); the row layout is identical so one decoder reads both. */
static void record_event_struct(HANDLE *out, SRWLOCK *lock, volatile LONG *skip, uint64_t *seq,
                                const ProbeRegisters *r, uintptr_t ev_ptr, const uint64_t *entry_stack) {
    DWORD last_error = GetLastError();
    if (*out == INVALID_HANDLE_VALUE || !TryAcquireSRWLockExclusive(lock)) {
        InterlockedIncrement(skip);
        SetLastError(last_error);
        return;
    }
    unsigned char ev[0x70] = {0}; /* ev_ptr+0x00..0x6F == dump 0x10..0x7F */
    SIZE_T ev_bytes = snapshot(ev_ptr, ev, sizeof(ev));
    uint64_t stack0 = 0; snapshot((uintptr_t)entry_stack + 40, &stack0, 8);
    uintptr_t caller = (uintptr_t)*entry_stack;
    char line[10240]; /* schema 2: + entry rsp + RAW_WORDS raw stack words for offline unwinding */
    int n = snprintf(line, sizeof(line), "%llu\t%llu\t%lu\t%ld\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t%zu",
        (unsigned long long)++*seq, (unsigned long long)(GetTickCount64()-started),
        GetCurrentThreadId(), InterlockedCompareExchange(skip,0,0),
        (unsigned long long)caller,
        (unsigned long long)((caller >= module_base && caller < module_base+0x21396000) ? caller-module_base : 0),
        (unsigned long long)r->gpr[0], (unsigned long long)ev_ptr, (unsigned long long)r->gpr[2], (unsigned long long)r->gpr[3], ev_bytes);
    /* Decoded view with dump offsets in the column names; the raw words follow so nothing is lost. */
    #define U32(off) ev_u32(ev, (off))
    #define I32(off) ev_i32(ev, (off))
    #define F32(off) ev_f32(ev, (off))
    #define U64(off) ev_u64(ev, (off))
    #define B8(off)  ev_b8(ev, (off))
    n += snprintf(line+n, sizeof(line)-n, "\t%lu\t%lu\t0x%016llx\t0x%016llx\t%lu",
        U32(0x10), U32(0x14), U64(0x18), U64(0x20), U32(0x28));
    n += snprintf(line+n, sizeof(line)-n, "\t%.9g\t%lu\t%u\t%lu\t%u\t%lu\t%.9g\t%lu",
        F32(0x44), U32(0x48), B8(0x4c), U32(0x50), B8(0x54), U32(0x58), F32(0x5c), U32(0x60));
    n += snprintf(line+n, sizeof(line)-n, "\t%u\t%u\t%u\t%u\t%u\t%u\t%u\t%u\t%u\t%u",
        B8(0x64), B8(0x65), B8(0x66), B8(0x67), B8(0x68), B8(0x69), B8(0x6a), B8(0x6b), B8(0x6c), B8(0x6d));
    n += snprintf(line+n, sizeof(line)-n, "\t%.9g\t%ld\t%u", F32(0x70), I32(0x74), B8(0x78));
    #undef U32
    #undef I32
    #undef F32
    #undef U64
    #undef B8
    for (int i = 0; i < 14; i++) { uint64_t w; memcpy(&w, ev + i*8, 8); n += snprintf(line+n, sizeof(line)-n, "\t0x%016llx", (unsigned long long)w); }
    n += snprintf(line+n, sizeof(line)-n, "\t0x%016llx", (unsigned long long)stack0);
    /* Raw stack from the entry rsp upward, for an offline unwind against the saved binary. The
     * words are logged untouched; classification happens offline where frame sizes are known. */
    n += snprintf(line+n, sizeof(line)-n, "\t0x%016llx", (unsigned long long)(uintptr_t)entry_stack);
    uint64_t raw[RAW_WORDS];
    SIZE_T raw_bytes = snapshot((uintptr_t)entry_stack, raw, sizeof(raw));
    n += snprintf(line+n, sizeof(line)-n, "\t%zu", raw_bytes);
    for (int i = 0; i < RAW_WORDS; i++) n += snprintf(line+n, sizeof(line)-n, "\t0x%llx", (unsigned long long)raw[i]);
    n += snprintf(line+n, sizeof(line)-n, "\n");
    DWORD written = 0;
    if (!WriteFile(*out, line, (DWORD)strlen(line), &written, NULL) || written != strlen(line))
        InterlockedIncrement(skip);
    ReleaseSRWLockExclusive(lock);
    SetLastError(last_error);
}

void damage_event_record(const ProbeRegisters *r, const uint64_t *entry_stack) {
    record_event_struct(&event_output, &event_lock, &event_skipped, &event_sequence, r, (uintptr_t)r->gpr[1], entry_stack);
}
void damage_enqueue_record(const ProbeRegisters *r, const uint64_t *entry_stack) {
    record_event_struct(&enqueue_output, &enqueue_lock, &enqueue_skipped, &enqueue_sequence, r, (uintptr_t)r->gpr[0], entry_stack);
}

/* Allocate executable-to-be memory within +/-2 GB of `near`, so a relocated RIP-relative
 * instruction can be re-based into it. VirtualAlloc(NULL) may land anywhere in the 64-bit
 * space; walk outward from the target in allocation-granularity steps until one succeeds. */
static void *alloc_near(uintptr_t anchor, SIZE_T size) {
    const uintptr_t step = 0x10000; /* allocation granularity */
    uintptr_t base = anchor & ~(step - 1);
    for (uintptr_t off = step; off < 0x7FF00000; off += step) {
        void *p;
        if ((p = VirtualAlloc((void *)(base + off), size, MEM_COMMIT|MEM_RESERVE, PAGE_READWRITE)) != NULL) return p;
        if (base > off && (p = VirtualAlloc((void *)(base - off), size, MEM_COMMIT|MEM_RESERVE, PAGE_READWRITE)) != NULL) return p;
    }
    return NULL;
}

/* Persist each probe's install status beside the launcher, so a refusal is visible after the
 * console is gone. Appended, one line per probe per launch. */
void damage_probe_note_status(const char *name, int status) {
    char path[MAX_PATH + 32]; snprintf(path, sizeof(path), "%sdamage-probe-status.txt", probe_session_dir);
    HANDLE h = CreateFileA(path, FILE_APPEND_DATA, FILE_SHARE_READ, NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return;
    char line[160]; SYSTEMTIME now; GetSystemTime(&now);
    int n = snprintf(line, sizeof(line), "%04u-%02u-%02u %02u:%02u:%02u UTC pid %lu\t%s\t%d\n",
        now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond, GetCurrentProcessId(), name, status);
    DWORD w; WriteFile(h, line, (DWORD)n, &w, NULL); CloseHandle(h);
}

/* Shared column header for both struct-carrying hooks (the schema line differs). */
static int write_event_header(HANDLE h, const char *schema_line) {
    static const char *columns =
        "sequence\telapsed_ms\tthread\tskipped\tcaller\tcaller_rva\tthis\tevent_ptr\ttarget_entity\targ3\tevent_bytes"
        "\tu32_10\tu32_14\thandle_18\thandle_20\tu32_28"
        "\tf32_44\tu32_48\tb_4c\telement_50\tb_54\tu32_58\tf32_5c\tspecial_60"
        "\tb_64\tb_65\tb_66\tb_67\tb_68\tb_69\tb_6a\tb_6b\tb_6c\tb_6d"
        "\tf32_70\ti32_74\tb_78";
    DWORD written = 0; char column[32];
    if (!WriteFile(h, schema_line, (DWORD)strlen(schema_line), &written, NULL) || written != strlen(schema_line)) return 0;
    if (!WriteFile(h, columns, (DWORD)strlen(columns), &written, NULL) || written != strlen(columns)) return 0;
    for (int i = 0; i < 14; i++) { snprintf(column, sizeof(column), "\tev_mem%d", i); WriteFile(h, column, (DWORD)strlen(column), &written, NULL); }
    WriteFile(h, "\tstack0_vec3ptr\trsp_entry\traw_bytes", 35, &written, NULL);
    for (int i = 0; i < RAW_WORDS; i++) { snprintf(column, sizeof(column), "\traw%d", i); WriteFile(h, column, (DWORD)strlen(column), &written, NULL); }
    WriteFile(h, "\n", 1, &written, NULL);
    return 1;
}
static int enqueue_header_write(HANDLE h) {
    return write_event_header(h, "# schema=2 client=CNBetaWin3.3.2 target_rva=0x133d4590 raw=stack_words_from_rsp_entry clock=shared_with_string_probe values=damage_display_event_struct_at_enqueue dump_offset=rcx_offset+0x10\n");
}
static int event_header_write(HANDLE h) {
    return write_event_header(h, "# schema=2 client=CNBetaWin3.3.2 target_rva=0x14b106e0 raw=stack_words_from_rsp_entry clock=shared_with_string_probe values=damage_display_event_struct dump_offset=rdx_offset+0x10\n");
}

/* Enqueue hook installer. Prologue: push rsi (1) / sub rsp,0x90 (7) / mov rsi,rcx (3) = 11
 * position-independent bytes, then a 7-byte `cmp byte ptr [rip+disp32], 0` (80 3D disp32 imm8)
 * ending at +18. The patch is 12 bytes + 6 NOPs so the boundary at +18 stays clean; the stub
 * relocates all 18 bytes and re-bases the cmp's disp32 so it addresses the same absolute byte. */
#define ENQUEUE_RELOC 18
int damage_enqueue_start(void) {
    if (!module_base || !damage_probe_original) return -7;
    if (damage_enqueue_original) return -6;
    unsigned char *target = (unsigned char *)(module_base + 0x133d4590);
    if (memcmp(target, enqueue_fingerprint, sizeof(enqueue_fingerprint))) return -3;
    unsigned char *stub = alloc_near((uintptr_t)target, ENQUEUE_RELOC + 14); /* must be within +/-2 GB: see the cmp re-base */
    if (!stub) return -4;
    memcpy(stub, target, ENQUEUE_RELOC);
    {   /* cmp at +11: instruction end at +18 in both copies; disp is relative to the instruction end */
        int32_t disp; memcpy(&disp, target + 13, 4);
        uintptr_t absolute = (uintptr_t)target + 18 + (intptr_t)disp;
        intptr_t rebased = (intptr_t)absolute - (intptr_t)(stub + 18);
        if (rebased != (int32_t)rebased) { VirtualFree(stub,0,MEM_RELEASE); return -8; } /* stub not within +/-2 GB */
        int32_t nd = (int32_t)rebased; memcpy(stub + 13, &nd, 4);
    }
    memcpy(stub + ENQUEUE_RELOC, "\xff\x25\0\0\0\0", 6);
    uintptr_t continuation = (uintptr_t)target + ENQUEUE_RELOC;
    memcpy(stub + ENQUEUE_RELOC + 6, &continuation, 8);
    DWORD previous;
    if (!VirtualProtect(stub, ENQUEUE_RELOC + 14, PAGE_EXECUTE_READ, &previous)) { VirtualFree(stub,0,MEM_RELEASE); return -4; }
    FlushInstructionCache(GetCurrentProcess(), stub, ENQUEUE_RELOC + 14);
    enqueue_output = probe_open("enqueue", enqueue_header_write);
    if (enqueue_output == INVALID_HANDLE_VALUE) { VirtualFree(stub,0,MEM_RELEASE); return -5; }
    if (!VirtualProtect(target, ENQUEUE_RELOC, PAGE_EXECUTE_READWRITE, &previous)) {
        CloseHandle(enqueue_output); enqueue_output = INVALID_HANDLE_VALUE; VirtualFree(stub,0,MEM_RELEASE); return -4;
    }
    damage_enqueue_original = (uintptr_t)stub;
    unsigned char patch[ENQUEUE_RELOC] = {0x48,0xb8}; uintptr_t entry = (uintptr_t)&damage_enqueue_entry;
    memcpy(patch+2, &entry, 8); patch[10] = 0xff; patch[11] = 0xe0; memset(patch+12, 0x90, ENQUEUE_RELOC-12);
    memcpy(target, patch, ENQUEUE_RELOC); FlushInstructionCache(GetCurrentProcess(), target, ENQUEUE_RELOC);
    DWORD ignored;
    if (!VirtualProtect(target, ENQUEUE_RELOC, previous, &ignored)) return 2;
    return 1;
}

/* Same contract as the numeric probe: only after the string probe validated the PE and installed;
 * 12-byte relocation (eight independent pushes, verified in the fingerprint). */
int damage_event_start(void) {
    if (!module_base || !damage_probe_original) return -7;
    if (damage_event_original) return -6;
    unsigned char *target = (unsigned char *)(module_base + 0x14b106e0);
    if (memcmp(target, event_fingerprint, sizeof(event_fingerprint))) return -3;
    unsigned char *stub = VirtualAlloc(NULL, 26, MEM_COMMIT|MEM_RESERVE, PAGE_READWRITE);
    if (!stub) return -4;
    memcpy(stub, target, 12);
    memcpy(stub+12, "\xff\x25\0\0\0\0", 6);
    uintptr_t continuation = (uintptr_t)target + 12;
    memcpy(stub+18, &continuation, 8);
    DWORD previous;
    if (!VirtualProtect(stub, 26, PAGE_EXECUTE_READ, &previous)) { VirtualFree(stub,0,MEM_RELEASE); return -4; }
    FlushInstructionCache(GetCurrentProcess(), stub, 26);
    event_output = probe_open("event", event_header_write);
    if (event_output == INVALID_HANDLE_VALUE) { VirtualFree(stub,0,MEM_RELEASE); return -5; }
    if (!VirtualProtect(target, 12, PAGE_EXECUTE_READWRITE, &previous)) {
        CloseHandle(event_output); event_output = INVALID_HANDLE_VALUE; VirtualFree(stub,0,MEM_RELEASE); return -4;
    }
    damage_event_original = (uintptr_t)stub;
    unsigned char patch[12] = {0x48,0xb8}; uintptr_t entry = (uintptr_t)&damage_event_entry;
    memcpy(patch+2, &entry, 8); patch[10] = 0xff; patch[11] = 0xe0;
    memcpy(target, patch, 12); FlushInstructionCache(GetCurrentProcess(), target, 12);
    DWORD ignored;
    if (!VirtualProtect(target, 12, previous, &ignored)) return 2;
    return 1;
}

static int string_header_write(HANDLE h) {
    int ok = put(h,"# schema=2 client=" PIN_CLIENT " target_rva=" PIN_STR(PIN_DamageTextController_query_RVA)
        " values=unclassified_UI_inputs p12=stack_slot_9_snapshot ret=stack_index:rva_shallowest_first\n");
    ok &= put(h,"sequence\telapsed_ms\tthread\tskipped\tcaller\tcaller_rva\tstack_bytes\targ1_bytes");
    char column[32];
    for(int i=0;i<18;i++){snprintf(column,sizeof(column),"\targ%d",i);ok&=put(h,column);}
    for(int i=0;i<6;i++)for(int j=0;j<2;j++){snprintf(column,sizeof(column),"\txmm%d_%d",i,j);ok&=put(h,column);}
    for(int i=0;i<8;i++){snprintf(column,sizeof(column),"\targ1_mem%d",i);ok&=put(h,column);}
    ok &= put(h,"\tp12_bytes");
    for(int i=0;i<16;i++){snprintf(column,sizeof(column),"\tp12_mem%d",i);ok&=put(h,column);}
    ok &= put(h,"\tret_count");
    for(int i=0;i<RET_MAX;i++){snprintf(column,sizeof(column),"\tret%d",i);ok&=put(h,column);}
    ok &= put(h,"\n");
    return ok;
}

/* 0 disabled, 1 installed, negative = refused/failed. No partial installation on a
 * fingerprint mismatch. A timestamp AND 64-byte code fingerprint gate this exact build. */
int damage_probe_start(void) {
    /* On by default since 2026-09-28 (the public build); damage-probe-disable.txt beside the
     * launcher turns it off. The old damage-probe-enable.txt is no longer needed. */
    if (GetFileAttributesA("damage-probe-disable.txt") != INVALID_FILE_ATTRIBUTES) return 0;
    if (damage_probe_original) return -6;
    HMODULE module = GetModuleHandleA("GameAssembly.dll");
    if (!module) return -1;
    module_base = (uintptr_t)module;
    const IMAGE_DOS_HEADER *dos = (const IMAGE_DOS_HEADER *)module;
    const IMAGE_NT_HEADERS64 *pe = (const IMAGE_NT_HEADERS64 *)(module_base + dos->e_lfanew);
    if (dos->e_magic != IMAGE_DOS_SIGNATURE || pe->Signature != IMAGE_NT_SIGNATURE ||
        pe->FileHeader.TimeDateStamp != PIN_TIMESTAMP || pe->OptionalHeader.SizeOfImage != PIN_SIZE_OF_IMAGE) return -2;
    load_exec_ranges();
    /* DamageTextController.query (src/pins.h): a NAMED class, matched by shape inside it by
     * `tools/update/rederive.py match`. This probe is the PREREQUISITE for all four data probes --
     * they return -7 unless damage_probe_original is set -- so it must be re-pointed even though its
     * own damage-text output is now only the historical discovery trail. */
    unsigned char *target = (unsigned char *)(module_base+PIN_DamageTextController_query_RVA);
    static const unsigned char fingerprint[64] = PIN_DamageTextController_query_FINGERPRINT;
    if (memcmp(target,fingerprint,sizeof(fingerprint))) return -3;
    unsigned char *stub = VirtualAlloc(NULL,26,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);
    if (!stub) return -4;
    memcpy(stub,target,12); /* Exactly eight verified position-independent pushes. */
    memcpy(stub+12,"\xff\x25\0\0\0\0",6);
    uintptr_t continuation = (uintptr_t)target+12;
    memcpy(stub+18,&continuation,8);
    DWORD previous;
    if (!VirtualProtect(stub,26,PAGE_EXECUTE_READ,&previous)) { VirtualFree(stub,0,MEM_RELEASE); return -4; }
    FlushInstructionCache(GetCurrentProcess(),stub,26);
    output=probe_open("probe",string_header_write);
    if(output==INVALID_HANDLE_VALUE){VirtualFree(stub,0,MEM_RELEASE);return -5;}
    if(!VirtualProtect(target,12,PAGE_EXECUTE_READWRITE,&previous)){
        CloseHandle(output);output=INVALID_HANDLE_VALUE;VirtualFree(stub,0,MEM_RELEASE);return -4;
    }
    started=GetTickCount64();
    damage_probe_original=(uintptr_t)stub;
    unsigned char patch[12]={0x48,0xb8};
    uintptr_t entry=(uintptr_t)&damage_probe_entry;
    memcpy(patch+2,&entry,8);patch[10]=0xff;patch[11]=0xe0;
    memcpy(target,patch,12);
    FlushInstructionCache(GetCurrentProcess(),target,12);
    DWORD ignored;
    if(!VirtualProtect(target,12,previous,&ignored)) return 2; /* installed, protection restore failed */
    return 1;
}

/* ---- battle rotation (capture.zig) ---------------------------------------------------------------
 * Called on the game thread at BattleStatsSubsystem::OnAwake: every open probe file is finished
 * and reopened in the new battle folder, and the shared clock origin moves to `now` (the same tick
 * hitlog/eventlog take), so elapsed_ms in every file of a folder reads as time since that awake.
 * Sequence numbers keep counting across battles. */
void damage_probe_rotate(const char *battle_dir, ULONGLONG now) {
    snprintf(probe_battle_dir, sizeof(probe_battle_dir), "%s", battle_dir ? battle_dir : "");
    started = now;
    probe_reopen(&output, &output_lock, "probe", string_header_write);
    probe_reopen(&numeric_output, &numeric_lock, "numeric", numeric_header_write);
    probe_reopen(&event_output, &event_lock, "event", event_header_write);
    probe_reopen(&enqueue_output, &enqueue_lock, "enqueue", enqueue_header_write);
    probe_reopen(&result_output, &result_lock, "result", result_header_write);
    probe_reopen(&snapshot_output, &snapshot_lock, "snapshot", snapshot_header_write);
    probe_reopen(&daze_output, &daze_lock, "daze", daze_header_write);
    probe_reopen(&anomaly_output, &anomaly_lock, "anomaly", anomaly_header_write);
}

/* BattleStatsSubsystem::OnDestroy: the battle's rows reach the disk before the level unloads. */
void damage_probe_flush(void) {
    probe_flush(&output, &output_lock);
    probe_flush(&numeric_output, &numeric_lock);
    probe_flush(&event_output, &event_lock);
    probe_flush(&enqueue_output, &enqueue_lock);
    probe_flush(&result_output, &result_lock);
    probe_flush(&snapshot_output, &snapshot_lock);
    probe_flush(&daze_output, &daze_lock);
    probe_flush(&anomaly_output, &anomaly_lock);
}
