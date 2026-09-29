/* Exercise the actual recorder with an unreadable pointer and real file output. */
#include "damage_probe.c"
#include <stdlib.h>
void damage_probe_entry(void) {}
void damage_numeric_entry(void) {}
void damage_event_entry(void) {}
void damage_enqueue_entry(void) {}
void damage_result_entry(void) {}
void damage_snapshot_entry(void) {}
void damage_daze_entry(void) {}
void damage_anomaly_entry(void) {}
void statelog_on_hit(void) {} /* statelog.zig: damage_result_record calls it (per-hit stat reads) */
static void check(int ok){if(!ok){puts("FAIL recorder");exit(1);}}
/* Return-address classifier and stack scan against a synthetic "code" page: only words that
 * land in the declared executable range AND follow a call encoding count. */
static void test_return_scan(void){
    unsigned char *code=VirtualAlloc(NULL,4096,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);check(code!=NULL);
    memset(code,0x90,4096);
    module_base=(uintptr_t)code; exec_count=1; exec_ranges[0].lo=(uintptr_t)code; exec_ranges[0].hi=(uintptr_t)code+4096;
    code[0x100-5]=0xE8;                                  /* call rel32 -> 0x100 is a return */
    code[0x200-6]=0xFF;code[0x200-5]=0x15;               /* call [rip+d32] -> 0x200 */
    code[0x300-3]=0xFF;code[0x300-2]=0x52;               /* call [rdx+d8] -> 0x300 */
    code[0x400-2]=0xFF;code[0x400-1]=0xD0;               /* call rax -> 0x400 */
    code[0x500-3]=0x41;code[0x500-2]=0xFF;code[0x500-1]=0xD3; /* call r11 -> 0x500 */
    check(looks_like_return((uintptr_t)code+0x100)&&looks_like_return((uintptr_t)code+0x200));
    check(looks_like_return((uintptr_t)code+0x300)&&looks_like_return((uintptr_t)code+0x400)&&looks_like_return((uintptr_t)code+0x500));
    check(!looks_like_return((uintptr_t)code+0x600));    /* in range, preceded by NOPs: a data pointer */
    check(!looks_like_return((uintptr_t)code+8192));     /* out of range */
    check(!looks_like_return(0));
    uint64_t fake[SCAN_WORDS+4]={0};
    fake[0]=(uintptr_t)code+0x100; fake[7]=(uintptr_t)code+0x600; fake[40]=(uintptr_t)code+0x300; fake[SCAN_WORDS-1]=(uintptr_t)code+0x500; fake[SCAN_WORDS]=(uintptr_t)code+0x200;
    ReturnHit hits[RET_MAX];int n=scan_returns(fake,hits);
    check(n==3&&hits[0].index==0&&hits[0].rva==0x100&&hits[1].index==40&&hits[1].rva==0x300&&hits[2].index==SCAN_WORDS-1&&hits[2].rva==0x500);
    for(int i=0;i<RET_MAX+4;i++)fake[i]=(uintptr_t)code+0x400;   /* cap: never more than RET_MAX */
    check(scan_returns(fake,hits)==RET_MAX);
    module_base=0;exec_count=0;VirtualFree(code,0,MEM_RELEASE);
}
int main(void){
    test_return_scan();
    output=CreateFileA("damage-probe-recorder-test.tmp",GENERIC_WRITE|GENERIC_READ,0,NULL,CREATE_ALWAYS,FILE_ATTRIBUTE_TEMPORARY,NULL);
    check(output!=INVALID_HANDLE_VALUE);
    ProbeRegisters r={0}; r.gpr[0]=123;r.gpr[1]=1;r.gpr[2]=456;
    uint64_t stack[19]={0};stack[0]=0x12345;stack[5]=789;stack[18]=999;
    started=GetTickCount64();
    SetLastError(4567);damage_probe_record(&r,stack);check(GetLastError()==4567);
    check(sequence==1);
    AcquireSRWLockExclusive(&output_lock);
    damage_probe_record(&r,stack);check(sequence==1&&skipped==1);
    ReleaseSRWLockExclusive(&output_lock);
    SetFilePointer(output,0,NULL,FILE_BEGIN);
    char line[4096]={0};DWORD n=0;check(ReadFile(output,line,sizeof(line)-1,&n,NULL));
    check(strstr(line,"\t112\t0\t0x000000000000007b\t0x0000000000000001\t0x00000000000001c8")!=NULL);
    check(strstr(line,"0x0000000000000315")!=NULL&&strstr(line,"0x00000000000003e7")!=NULL);
    CloseHandle(output);DeleteFileA("damage-probe-recorder-test.tmp");
    numeric_output=CreateFileA("damage-numeric-recorder-test.tmp",GENERIC_WRITE|GENERIC_READ,0,NULL,CREATE_ALWAYS,FILE_ATTRIBUTE_TEMPORARY,NULL);
    check(numeric_output!=INVALID_HANDLE_VALUE);
    unsigned char item[64]={0};float input=3652.25f,auxiliary=0.125f,prior=100.5f;
    memcpy(item+0x2c,&prior,4);r.gpr[0]=(uintptr_t)item;r.gpr[2]=7;
    memcpy(&r.xmm[1][0],&input,4);memcpy(&r.xmm[3][0],&auxiliary,4);
    SetLastError(7890);damage_numeric_record(&r,stack);check(GetLastError()==7890&&numeric_sequence==1);
    /* Callback observes the input and prior accumulator separately; never mutates the item. */
    float untouched;memcpy(&untouched,item+0x2c,4);check(untouched==100.5f);
    r.gpr[0]=1;damage_numeric_record(&r,stack);check(numeric_sequence==2);
    AcquireSRWLockExclusive(&numeric_lock);damage_numeric_record(&r,stack);check(numeric_skipped==1&&numeric_sequence==2);ReleaseSRWLockExclusive(&numeric_lock);
    SetFilePointer(numeric_output,0,NULL,FILE_BEGIN);memset(line,0,sizeof(line));check(ReadFile(numeric_output,line,sizeof(line)-1,&n,NULL));
    check(strstr(line,"\t3652.25\t0x45644400\t7\t0.125\t100.5\t64")!=NULL);
    check(strstr(line,"\t7\t0.125\t0\t0")!=NULL); /* unreadable prior must be marked as unreadable */
    CloseHandle(numeric_output);numeric_output=INVALID_HANDLE_VALUE;DeleteFileA("damage-numeric-recorder-test.tmp");
    /* Event recorder: a synthetic struct at rdx, dump offsets = rdx offset + 0x10. */
    event_output=CreateFileA("damage-event-recorder-test.tmp",GENERIC_WRITE|GENERIC_READ,0,NULL,CREATE_ALWAYS,FILE_ATTRIBUTE_TEMPORARY,NULL);check(event_output!=INVALID_HANDLE_VALUE);
    unsigned char ev[0x70]={0};uint32_t sk=1181004;float dmg=4406.375f;uint32_t el=203;
    memcpy(ev+0x14-0x10,&sk,4);memcpy(ev+0x44-0x10,&dmg,4);memcpy(ev+0x50-0x10,&el,4);ev[0x54-0x10]=1;ev[0x78-0x10]=1;
    r.gpr[0]=0xAA;r.gpr[1]=(uintptr_t)ev;r.gpr[2]=0xBB;r.gpr[3]=0xCC;stack[5]=0xDD;
    SetLastError(31337);damage_event_record(&r,stack);check(GetLastError()==31337&&event_sequence==1);
    r.gpr[1]=1;damage_event_record(&r,stack);check(event_sequence==2);  /* unreadable struct: zero bytes, still a row */
    SetFilePointer(event_output,0,NULL,FILE_BEGIN);memset(line,0,sizeof(line));check(ReadFile(event_output,line,sizeof(line)-1,&n,NULL));
    check(strstr(line,"\t0xaa\t")!=NULL&&strstr(line,"\t0xbb\t0xcc\t112\t0\t1181004\t")!=NULL);
    check(strstr(line,"\t4406.375\t0\t0\t203\t1\t0\t0\t0\t")!=NULL);
    check(strstr(line,"\t0\t0\t1\t0x00")!=NULL); /* f32_70=0, i32_74=0, b_78=1, then raw words */
    check(strstr(line,"\t0x00000000000000dd\t0x")!=NULL); /* stack0 = the Vector3 pointer slot, then rsp_entry */
    { char want[64]; snprintf(want,sizeof(want),"\t0x%016llx\t",(unsigned long long)(uintptr_t)stack); check(strstr(line,want)!=NULL); } /* rsp_entry is the entry stack pointer */
    check(strstr(line,"\t0x1\t0xbb\t0xcc\t0\t0\t0\t")!=NULL); /* second row: event_bytes 0 */
    CloseHandle(event_output);event_output=INVALID_HANDLE_VALUE;DeleteFileA("damage-event-recorder-test.tmp");
    /* Enqueue recorder: same struct, read from rcx; separate stream and counters. */
    enqueue_output=CreateFileA("damage-enqueue-recorder-test.tmp",GENERIC_WRITE|GENERIC_READ,0,NULL,CREATE_ALWAYS,FILE_ATTRIBUTE_TEMPORARY,NULL);check(enqueue_output!=INVALID_HANDLE_VALUE);
    r.gpr[0]=(uintptr_t)ev;r.gpr[1]=0xEE;damage_enqueue_record(&r,stack);check(enqueue_sequence==1&&event_sequence==2);
    SetFilePointer(enqueue_output,0,NULL,FILE_BEGIN);memset(line,0,sizeof(line));check(ReadFile(enqueue_output,line,sizeof(line)-1,&n,NULL));
    { char want[64]; snprintf(want,sizeof(want),"%s0x%llx%s","	",(unsigned long long)(uintptr_t)ev,"	"); check(strstr(line,want)!=NULL); } /* event_ptr column is rcx */
    check(strstr(line,"	112	0	1181004	")!=NULL&&strstr(line,"	4406.375	")!=NULL);
    CloseHandle(enqueue_output);enqueue_output=INVALID_HANDLE_VALUE;DeleteFileA("damage-enqueue-recorder-test.tmp");
    puts("PASS: all four actual recorders; numeric input/prior distinction, no mutation, unreadable pointers, LastError and contention");
}
