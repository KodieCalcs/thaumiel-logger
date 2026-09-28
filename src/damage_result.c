/* Included by damage_probe.c: CNBetaWin3.3.0 typed result observation at
 * AGLNJHOEMAL::GPIPDCGLLNG(CJPACFEILFL, Entity, Entity, LBCELJNJAIK,
 * KLHIEGCFDIE, AGLNJHOEMAL&). Static: result is r9, output pointer stack[6].
 * No game calls, writes, or guessed field semantics. Snapshot BEFORE conversion.
 */
uintptr_t damage_result_original;
extern void damage_result_entry(void);
static HANDLE result_output = INVALID_HANDLE_VALUE;
static SRWLOCK result_lock = SRWLOCK_INIT;
static volatile LONG result_skipped;
static uint64_t result_sequence;
static const unsigned char result_fingerprint[64] = {
    0x55,0x41,0x57,0x41,0x56,0x41,0x55,0x41,0x54,0x56,0x57,0x53,0x48,0x81,0xec,0x78,
    0x01,0x00,0x00,0x48,0x8d,0xac,0x24,0x80,0x00,0x00,0x00,0x44,0x0f,0x29,0x95,0xe0,
    0x00,0x00,0x00,0x44,0x0f,0x29,0x8d,0xd0,0x00,0x00,0x00,0x44,0x0f,0x29,0x85,0xc0,
    0x00,0x00,0x00,0x0f,0x29,0xbd,0xb0,0x00,0x00,0x00,0x0f,0x29,0xb5,0xa0,0x00,0x00};
static const char *result_header =
    "# schema=5 client=CNBetaWin3.3.4 target_rva=0x19bf3530 a8=first_0x50_bytes_of_the_HMKMLBCLJAH_object_at_result+0x80 a8s18=string a8s20=string a8s28=string(slot_semantics_provisional_pending_capture,3.3.3_was_ability@0x28,attack_property@0x20,other@0x10) strings=0x10,0x30,0x88,0x90,0xb8,0xc0 geometry=result+0x60 dictionary=result+0xb0 phase=before_display_conversion string_encoding=utf16le_hex max_string_units=192 dictionary60_max_slots=128 dictionary60_stride=24 tags=List<String>_at_result+0x48(items+0x10,size+0x18,max_16) numeric_field_map=per-hit-log.mjs_LAYOUTS_CNBetaWin3.3.4\n"
    "sequence\telapsed_ms\tthread\tskipped\tcaller_rva\tcontext_ptr\tentity1_ptr\tentity2_ptr\tresult_ptr\tcomponent_ptr\toutput_event_ptr"
    "\tcontext_bytes\tcontext_hex\tentity1_bytes\tentity1_hex\tentity2_bytes\tentity2_hex\tresult_bytes\tresult_hex\tcomponent_bytes\tcomponent_hex"
    "\ts10_length\ts10_bytes\ts10_hex\ts40_length\ts40_bytes\ts40_hex\ts58_length\ts58_bytes\ts58_hex\ts70_length\ts70_bytes\ts70_hex"
    "\tsa0_length\tsa0_bytes\tsa0_hex\tsc0_length\tsc0_bytes\tsc0_hex"
    "\tgeometryb0_bytes\tgeometryb0_hex\tdict60_bytes\tdict60_hex\tentries60_capacity\tentries60_bytes\tentries60_hex\tkeys60"
    "\ta8_ptr\ta8_bytes\ta8_hex\ta8s18_length\ta8s18_bytes\ta8s18_hex\ta8s20_length\ta8s20_bytes\ta8s20_hex\ta8s28_length\ta8s28_bytes\ta8s28_hex"
    "\ttags_ptr\ttags_bytes\ttags_hex\ttags_size\ttags_capacity\ttags\n";

static char *result_hex(char *p, const unsigned char *bytes, SIZE_T n) {
    static const char hex[] = "0123456789abcdef";
    for (SIZE_T i=0;i<n;i++) { *p++=hex[bytes[i]>>4]; *p++=hex[bytes[i]&15]; }
    *p=0; return p;
}
static char *result_block(char *p, uintptr_t ptr, SIZE_T size) {
    unsigned char bytes[0x2b0];
    SIZE_T n=snapshot(ptr,bytes,size);
    p+=sprintf(p,"\t%llu\t",(unsigned long long)n);
    return result_hex(p,bytes,n);
}
static char *result_string(char *p, uintptr_t ptr) {
    int32_t length=-1; unsigned char bytes[384]; SIZE_T n=0;
    if (ptr && snapshot(ptr+0x10,&length,4)==4 && length>=0 && length<=1048576) {
        SIZE_T wanted=(SIZE_T)(length>192?192:length)*2;
        if (wanted) n=snapshot(ptr+0x14,bytes,wanted);
    } else length=-1;
    p+=sprintf(p,"\t%d\t%llu\t",length,(unsigned long long)n);
    return result_hex(p,bytes,n);
}
/* Concrete string->float dictionary verified from AKAPJICNCKE / 0x129833f0 (3.3.0) and re-verified
 * unchanged in 3.3.2 (BNBCOKGDMGF @ 0x184A1C10, FindEntry @ 0x12B05A70):
 * dictionary+0x18 entries; array+0x18 capacity, payload+0x20;
 * stride 24: hash at 0, key pointer at 8, float value at 16.
 * Preserve inactive/raw slots too; offline decoding rejects null keys/negative hashes.
 * Do not trust generic-definition field offsets (the metadata reports them as zero).
 */
static char *result_dictionary(char *p, uintptr_t ptr) {
    unsigned char header[0x50], entries[128*24]; SIZE_T n=snapshot(ptr,header,sizeof(header));
    p+=sprintf(p,"\t%llu\t",(unsigned long long)n);p=result_hex(p,header,n);
    uintptr_t array=0; uint64_t capacity=0; SIZE_T bytes=0;
    if(n>=0x20) memcpy(&array,header+0x18,8);
    if(array && snapshot(array+0x18,&capacity,8)==8 && capacity<=1048576) {
        SIZE_T slots=capacity>128?128:(SIZE_T)capacity;
        if(slots) bytes=snapshot(array+0x20,entries,slots*24);
    } else capacity=UINT64_MAX;
    p+=sprintf(p,"\t%llu\t%llu\t",(unsigned long long)capacity,(unsigned long long)bytes);
    p=result_hex(p,entries,bytes);*p++='\t';
    for(SIZE_T i=0;i<bytes/24;i++) {
        uintptr_t key;int32_t hash;memcpy(&hash,entries+i*24,4);memcpy(&key,entries+i*24+8,8);
        if(hash<0||!key)continue;
        /* One TSV cell: slot:length:bytes:utf16hex, separated by |. */
        char text[850];char *end=result_string(text,key);
        for(char *c=text;c<end;c++)if(*c=='\t')*c=':';
        p+=sprintf(p,"%llu%s|",(unsigned long long)i,text);
    }
    *p=0;return p;
}
/* Attribution by content (schema 5, lean): in 3.3.0 result+0xA8 was the pooled per-hit HPGPGOBHHFK
 * object whose +0x10 (ability name, e.g. Lisa_Rush) and +0x20 (AttackProperty name, e.g.
 * Lisa_Attack_Rush_AttackProperty_01) were System.String fields; +0x18 a third string slot
 * (empty in every capture so far). In 3.3.2 the object (now MDJPKKMNNCB) sits at result+0x20 and
 * its strings at +0x10/+0x20/+0x28; which slot carries which name is confirmed from the capture. Established by the hop-2 capture 20260912-230910: every hit,
 * including those that never pass through ConfigEntityAnimEvent, carries these names, and the
 * per-ability damage sums reconcile to the settlement. Fields end at +0x49; 0x50 bytes are kept
 * as raw hex for the small ints/bools there. Two hops, three strings, at most five reads. */
#define A8_BYTES 0x50
static char *result_a8(char *p, const unsigned char *result, SIZE_T count) {
    uintptr_t a8 = 0; unsigned char obj[A8_BYTES]; SIZE_T n = 0;
    /* 3.3.3: the per-hit name object moved +0x20 -> +0x50 (3.3.2 came from +0xA8 in 3.3.0). Its class
     * MDJPKKMNNCB -> KAMFFCFIJLK, matched structurally and unique: exactly one field of that type in
     * the result object in each build. Note +0x20 is a System.String in 3.3.3, so keeping the old
     * constant would have dereferenced a string as the name object.
     * 3.3.4: KAMFFCFIJLK -> HMKMLBCLJAH (one candidate), and the field moved +0x50 -> +0x80 --
     * again the only field of that type in the result object; 3.3.4's +0x50 is a different class. */
    if (count >= 0x80 + 8) memcpy(&a8, result + 0x80, 8);
    if (a8) n = snapshot(a8, obj, sizeof(obj));
    p += sprintf(p, "\t0x%llx\t%llu\t", (unsigned long long)a8, (unsigned long long)n);
    p = result_hex(p, obj, n);
    /* 3.3.4: HMKMLBCLJAH's three System.String fields are 0x18/0x20/0x28 (3.3.3: 0x10/0x20/0x28 --
     * the first string swapped places with the object pointer at +0x10). Which slot is the ability
     * vs. the AttackProperty name is settled by the first capture, not assumed. */
    const unsigned offsets[] = {0x18, 0x20, 0x28};
    for (unsigned i = 0; i < 3; i++) {
        uintptr_t str = 0; if (n >= offsets[i] + 8) memcpy(&str, obj + offsets[i], 8);
        p = result_string(p, str);
    }
    return p;
}
/* 3.3.4: HAJJIAGHAFN's only List<String> (+0x48), expected to be the hit's attack tags -- every
 * Anomaly instance is tagged "Buff" + its Anomaly ("Erosion", "Disorder", ...) and an Abloom also
 * "Abloom" (Leifa, 2026-09-28; the settlement carries the same lists). On the 2026-09-28 Disorder
 * capture the pointer is non-null and distinct on all 357 rows, Anomaly ticks included, so it is a
 * per-hit list, not a shared config one. List<T>: _items +0x10, _size +0x18 (the dump reports
 * generic-definition offsets as zero, as for the dictionary above); the raw 0x20-byte header is
 * kept so the first capture verifies both. One TSV cell: index:length:bytes:utf16hex, | separated. */
#define TAGS_MAX 16
static char *result_tags(char *p, const unsigned char *result, SIZE_T count) {
    uintptr_t list=0, items=0; unsigned char header[0x20]; SIZE_T n=0;
    int32_t size=-1; uint64_t capacity=UINT64_MAX;
    if(count>=0x48+8) memcpy(&list,result+0x48,8);
    if(list) n=snapshot(list,header,sizeof(header));
    p+=sprintf(p,"\t0x%llx\t%llu\t",(unsigned long long)list,(unsigned long long)n);
    p=result_hex(p,header,n);
    if(n>=0x1c) { memcpy(&items,header+0x10,8); memcpy(&size,header+0x18,4); }
    if(!items || snapshot(items+0x18,&capacity,8)!=8 || capacity>1048576) capacity=UINT64_MAX;
    p+=sprintf(p,"\t%d\t%lld\t",size,capacity==UINT64_MAX?-1LL:(long long)capacity);
    if(size>0 && capacity!=UINT64_MAX && (uint64_t)size<=capacity) {
        uintptr_t strings[TAGS_MAX]; SIZE_T wanted=size>TAGS_MAX?TAGS_MAX:(SIZE_T)size;
        SIZE_T got=snapshot(items+0x20,strings,wanted*8)/8;
        for(SIZE_T i=0;i<got;i++) {
            char text[850]; char *end=result_string(text,strings[i]);
            for(char *c=text;c<end;c++) if(*c=='\t') *c=':';
            p+=sprintf(p,"%llu%s|",(unsigned long long)i,text);
        }
    }
    *p=0; return p;
}
void damage_result_record(const ProbeRegisters *r, const uint64_t *entry_stack) {
    DWORD error=GetLastError();
    if (result_output==INVALID_HANDLE_VALUE) { SetLastError(error); return; }
    if (!TryAcquireSRWLockExclusive(&result_lock)) { InterlockedIncrement(&result_skipped); SetLastError(error); return; }
    uint64_t stack[7]; snapshot((uintptr_t)entry_stack,stack,sizeof(stack));
    /* 3.3.4: the result object grew -- its last instance field sits at +0x2a0 (3.3.3: +0x284),
     * so the raw dump is 0x2b0 to cover it with alignment slack. */
    unsigned char result[0x2b0]; SIZE_T count=snapshot(r->gpr[3],result,sizeof(result));
    /* Lock-owned buffer, not a 128 KB allocation on the game's stack. Worst case:
     * <9 KB original row + <7 KB raw nested data + 128*(768+80) key bytes + <1.3 KB a8
     * + 16*(768+40) tag bytes <138 KB. */
    static char line[163840]; char *p=line;
    p+=sprintf(p,"%llu\t%llu\t%lu\t%ld\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx",
        (unsigned long long)++result_sequence,(unsigned long long)(GetTickCount64()-started),GetCurrentThreadId(),result_skipped,
        (unsigned long long)(stack[0]>=module_base?stack[0]-module_base:0),
        r->gpr[0],r->gpr[1],r->gpr[2],r->gpr[3],stack[5],stack[6]);
    p=result_block(p,r->gpr[0],0x50); p=result_block(p,r->gpr[1],0x80); p=result_block(p,r->gpr[2],0x80);
    p+=sprintf(p,"\t%llu\t",(unsigned long long)count); p=result_hex(p,result,count);
    p=result_block(p,stack[5],0x160);
    /* 3.3.4: the result object's six System.String fields, the complete sorted set (HAJJIAGHAFN
     * has exactly six, as KJDILJALAJA did). 3.3.3: 0x20,0x28,0x38,0x40,0xa0,0xb0; 3.3.2:
     * 0x28,0x58,0x88,0x90,0xb8,0xc8. Mapped positionally, as the previous re-derivations were;
     * the attenuation-curve slot 0xa0 -> 0x88 also has a factory `lea` code witness. */
    const unsigned offsets[]={0x10,0x30,0x88,0x90,0xb8,0xc0};
    for(unsigned i=0;i<6;i++) { uintptr_t ptr=0; if(count>=offsets[i]+8) memcpy(&ptr,result+offsets[i],8); p=result_string(p,ptr); }
    uintptr_t geometry=0,dict=0;
    if(count>=0x68)memcpy(&geometry,result+0x60,8); /* 3.3.4: the nested-struct backing field moved
                                                    * +0x78 -> +0x60 (only one such field each build) */
    if(count>=0xb8)memcpy(&dict,result+0xb0,8); /* 3.3.4: Dictionary<String,Single> moved +0xc8 -> +0xb0;
                                                 * exactly one field of that type in each build */
    p=result_block(p,geometry,0x78);p=result_dictionary(p,dict);
    p=result_a8(p,result,count);
    p=result_tags(p,result,count);
    *p++='\n'; DWORD written=0;
    if(!WriteFile(result_output,line,(DWORD)(p-line),&written,NULL)||written!=(DWORD)(p-line)) InterlockedIncrement(&result_skipped);
    ReleaseSRWLockExclusive(&result_lock); SetLastError(error);
}
static int result_header_write(HANDLE h) { return put(h, result_header); }

int damage_result_start(void) {
    if (!module_base || !damage_probe_original) return -7;
    if (damage_result_original) return -6;
    /* CNBetaWin3.3.4: OLIFMMEBMGL::LHDFOBIAEGA (3.3.3: 0x1a495bf0 NJCELHGICGI::EBFKHCOHMDO).
     * Located 2026-09-25: the result struct's class matched structurally with one candidate, and
     * the converter shape-matched 0.997 over all 747 instructions (runner-up 0.212). Its first
     * 64 bytes are byte-identical to 3.3.3, so the fingerprint above needed no change -- the
     * same cross-check on the identification as last build. */
    unsigned char *target=(unsigned char *)(module_base+0x19bf3530);
    if(memcmp(target,result_fingerprint,64)) return -3;
    unsigned char *stub=VirtualAlloc(NULL,26,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);
    if(!stub) return -4;
    memcpy(stub,target,12); /* Eight complete pushes, no relative addressing. */
    memcpy(stub+12,"\xff\x25\0\0\0\0",6);
    uintptr_t continuation=(uintptr_t)target+12; memcpy(stub+18,&continuation,8);
    DWORD previous;
    if(!VirtualProtect(stub,26,PAGE_EXECUTE_READ,&previous)) { VirtualFree(stub,0,MEM_RELEASE); return -4; }
    FlushInstructionCache(GetCurrentProcess(),stub,26);
    result_output=probe_open("result",result_header_write);
    if(result_output==INVALID_HANDLE_VALUE) { VirtualFree(stub,0,MEM_RELEASE); return -5; }
    if(!VirtualProtect(target,12,PAGE_EXECUTE_READWRITE,&previous)) {
        CloseHandle(result_output); result_output=INVALID_HANDLE_VALUE; VirtualFree(stub,0,MEM_RELEASE); return -4;
    }
    damage_result_original=(uintptr_t)stub;
    unsigned char patch[12]={0x48,0xb8}; uintptr_t entry=(uintptr_t)&damage_result_entry;
    memcpy(patch+2,&entry,8); patch[10]=0xff; patch[11]=0xe0;
    memcpy(target,patch,12); FlushInstructionCache(GetCurrentProcess(),target,12);
    DWORD ignored; if(!VirtualProtect(target,12,previous,&ignored)) return 2;
    return 1;
}
