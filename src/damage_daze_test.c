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
#define CHECK(x) do {if(!(x)){printf("FAIL line %d: %s\n",__LINE__,#x);exit(1);}} while(0)
int main(void) {
    CHECK(damage_daze_start()==-7);
    unsigned char *image=VirtualAlloc(NULL,0x21591000,MEM_RESERVE,PAGE_NOACCESS); CHECK(image);
    CHECK(VirtualAlloc(image+(DAZE_RVA&~0xfff),4096,MEM_COMMIT,PAGE_READWRITE));
    unsigned char *target=image+DAZE_RVA; memcpy(target,daze_fingerprint,64);
    module_base=(uintptr_t)image; damage_probe_original=1;
    target[20]^=1; CHECK(damage_daze_start()==-3); CHECK(!damage_daze_original&&daze_output==INVALID_HANDLE_VALUE); CHECK(target[0]==0x41); target[20]^=1;
    CHECK(damage_daze_start()==1); CHECK(damage_daze_start()==-6);
    CHECK(!memcmp((void*)damage_daze_original,daze_fingerprint,12));
    uintptr_t continuation; memcpy(&continuation,(unsigned char*)damage_daze_original+18,8); CHECK(continuation==(uintptr_t)target+12);
    CHECK(target[0]==0x48&&target[10]==0xff&&target[11]==0xe0&&target[12]==0x48); /* byte 12 (sub rsp) untouched */
    char path[1024]; CHECK(GetFinalPathNameByHandleA(daze_output,path,sizeof(path),0)); CloseHandle(daze_output); CHECK(DeleteFileA(path));
    daze_output=CreateFileA("damage-daze-test.tmp",GENERIC_WRITE|GENERIC_READ,0,NULL,CREATE_ALWAYS,FILE_ATTRIBUTE_TEMPORARY,NULL); CHECK(daze_output!=INVALID_HANDLE_VALUE);
    /* Recorder: stun component (this) with CurStun-before and target floats, ctx with the result pointer, result floats. */
    unsigned char self[DAZE_THIS_BYTES], ctx[DAZE_CTX_BYTES], result[0x290]; memset(self,0x5A,sizeof(self)); memset(ctx,0xA5,sizeof(ctx)); memset(result,0,sizeof(result));
    float before=1234.5f, tgt=1373.096f, dmv=0.2068f, imp=86.0f;
    memcpy(self+DAZE_THIS_BEFORE,&before,4); memcpy(self+DAZE_THIS_TARGET,&tgt,4);
    uint64_t entity=0x7000deadbeef; memcpy(self+DAZE_THIS_ENTITY,&entity,8);
    uint64_t rp=(uint64_t)(uintptr_t)result; memcpy(ctx+DAZE_CTX_RESULT,&rp,8);
    memcpy(result+DAZE_RESULT_DAZE_MV,&dmv,4); memcpy(result+DAZE_RESULT_IMPACT,&imp,4);
    ProbeRegisters r={0}; r.gpr[0]=(uintptr_t)self; r.gpr[1]=(uintptr_t)ctx;
    uint64_t stack[9]={0}; stack[0]=module_base+0x1a7397f4;
    unsigned char before_bytes[DAZE_THIS_BYTES]; memcpy(before_bytes,self,sizeof(self));
    SetLastError(4321); damage_daze_record(&r,stack); CHECK(GetLastError()==4321&&daze_sequence==1); CHECK(!memcmp(before_bytes,self,sizeof(self)));
    r.gpr[1]=1; damage_daze_record(&r,stack); CHECK(daze_sequence==2); /* unreadable ctx: result_ptr 0, result floats -1, row still written */
    r.gpr[0]=0; r.gpr[1]=0; damage_daze_record(&r,stack); CHECK(daze_sequence==3); /* null this and ctx: nothing dereferenced */
    AcquireSRWLockExclusive(&daze_lock); damage_daze_record(&r,stack); CHECK(daze_sequence==3&&daze_skipped==1); ReleaseSRWLockExclusive(&daze_lock);
    SetFilePointer(daze_output,0,NULL,FILE_BEGIN); static char text[16384]; DWORD n; CHECK(ReadFile(daze_output,text,sizeof(text)-1,&n,NULL)); text[n]=0;
    { char want[256]; snprintf(want,sizeof(want),"\t0x1a7397f4\t0x%llx\t0x%llx\t0x%llx\t0x7000deadbeef\t1234.5\t1373.09595\t0.206799999\t86\t256\t",(unsigned long long)(uintptr_t)self,(unsigned long long)(uintptr_t)ctx,(unsigned long long)(uintptr_t)result);
      char *cell=strstr(text,want); CHECK(cell); cell+=strlen(want);
      CHECK(!memcmp(cell,"5a5a5a5a",8)); CHECK(!memcmp(cell+DAZE_THIS_BEFORE*2,"00509a44",8)); /* 1234.5f = 0x449a5000 little-endian */
      CHECK(!strncmp(cell+DAZE_THIS_BYTES*2,"\t80\ta5a5a5a5",12)); }
    CHECK(strstr(text,"\t0x1\t0x0\t0x7000deadbeef\t1234.5\t1373.09595\t-1\t-1\t256\t")); /* second row: ctx unreadable */
    CHECK(strstr(text,"\t0x0\t0x0\t0x0\t0x0\t-1\t-1\t-1\t-1\t0\t\t0\t\t3\n")); /* third row: null this/ctx; order 3 */
    CHECK(strstr(text,"\t1\n")&&strstr(text,"\t2\n")&&log_order==4); /* order: one per call, the lock-skipped call too (a gap, never a reuse) */
    CHECK(thaumiel_log_next_order()==5); /* the counter statelog.zig takes its rows' order from */
    CHECK(strstr(text,"\tthis_hex")==NULL); /* header not in the data rows */
    CloseHandle(daze_output); DeleteFileA("damage-daze-test.tmp");
    VirtualFree((void*)damage_daze_original,0,MEM_RELEASE); VirtualFree(image,0,MEM_RELEASE);
    puts("PASS daze: install gates/relocation, duplicate refusal, this/ctx snapshots, result pointer and floats, unreadable ctx, null this/ctx, unchanged input, lock skip, last error");
}
