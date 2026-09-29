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
    CHECK(damage_snapshot_start()==-7);
    unsigned char *image=VirtualAlloc(NULL,0x21591000,MEM_RESERVE,PAGE_NOACCESS); CHECK(image);
    CHECK(VirtualAlloc(image+(SNAPSHOT_RVA&~0xfff),4096,MEM_COMMIT,PAGE_READWRITE));
    unsigned char *target=image+SNAPSHOT_RVA; memcpy(target,snapshot_fingerprint,64);
    module_base=(uintptr_t)image; damage_probe_original=1;
    target[20]^=1; CHECK(damage_snapshot_start()==-3); CHECK(!damage_snapshot_original&&snapshot_output==INVALID_HANDLE_VALUE); CHECK(target[0]==0x41); target[20]^=1;
    CHECK(damage_snapshot_start()==1); CHECK(damage_snapshot_start()==-6);
    CHECK(!memcmp((void*)damage_snapshot_original,snapshot_fingerprint,12));
    uintptr_t continuation; memcpy(&continuation,(unsigned char*)damage_snapshot_original+18,8); CHECK(continuation==(uintptr_t)target+12);
    CHECK(target[0]==0x48&&target[10]==0xff&&target[11]==0xe0&&target[12]==0x48); /* byte 12 (sub rsp) untouched */
    char path[1024]; CHECK(GetFinalPathNameByHandleA(snapshot_output,path,sizeof(path),0)); CloseHandle(snapshot_output); CHECK(DeleteFileA(path));
    snapshot_output=CreateFileA("damage-snapshot-test.tmp",GENERIC_WRITE|GENERIC_READ,0,NULL,CREATE_ALWAYS,FILE_ATTRIBUTE_TEMPORARY,NULL); CHECK(snapshot_output!=INVALID_HANDLE_VALUE);
    /* Recorder: whole 0x200-byte snapshot from rcx, 0x190-byte object from r9, stack params 5..7 and MethodInfo. */
    unsigned char snap[0x200], arg4[0x190]; memset(snap,0x5A,sizeof(snap)); memset(arg4,0xA5,sizeof(arg4));
    float atk=3370.4f; memcpy(snap+0x130,&atk,4);
    ProbeRegisters r={0}; r.gpr[0]=(uintptr_t)snap; r.gpr[1]=0x22; r.gpr[2]=0x33; r.gpr[3]=(uintptr_t)arg4;
    uint64_t stack[9]={0}; stack[0]=module_base+0x1234; stack[5]=0x55; stack[6]=0x66; stack[7]=0x77; stack[8]=0x88;
    unsigned char before[0x200]; memcpy(before,snap,sizeof(snap));
    SetLastError(4321); damage_snapshot_record(&r,stack); CHECK(GetLastError()==4321&&snapshot_sequence==1); CHECK(!memcmp(before,snap,sizeof(snap)));
    r.gpr[3]=1; damage_snapshot_record(&r,stack); CHECK(snapshot_sequence==2); /* unreadable arg4: 0 bytes, row still written */
    AcquireSRWLockExclusive(&snapshot_lock); damage_snapshot_record(&r,stack); CHECK(snapshot_sequence==2&&snapshot_skipped==1); ReleaseSRWLockExclusive(&snapshot_lock);
    SetFilePointer(snapshot_output,0,NULL,FILE_BEGIN); static char text[16384]; DWORD n; CHECK(ReadFile(snapshot_output,text,sizeof(text)-1,&n,NULL)); text[n]=0;
    { char want[256]; snprintf(want,sizeof(want),"\t0x1234\t0x%llx\t0x22\t0x33\t0x%llx\t0x55\t0x66\t0x77\t0x88\t512\t",(unsigned long long)(uintptr_t)snap,(unsigned long long)(uintptr_t)arg4);
      char *cell=strstr(text,want); CHECK(cell); cell+=strlen(want);
      CHECK(!memcmp(cell,"5a5a5a5a",8)); CHECK(!memcmp(cell+0x130*2,"66a65245",8)); /* 3370.4f = 0x4552a666 little-endian */
      CHECK(!strncmp(cell+0x200*2,"\t400\ta5a5a5a5",13)); }
    CHECK(strstr(text,"\t0x1\t0x55\t0x66\t0x77\t0x88\t512\t")&&strstr(text,"\t0\t\t2\n")); /* second row: arg4 unreadable; order 2 */
    CHECK(log_order==3); /* the lock-skipped call took 3 */
    CHECK(strstr(text,"\tsnapshot_hex")==NULL); /* header not in the data rows */
    CloseHandle(snapshot_output); DeleteFileA("damage-snapshot-test.tmp");
    VirtualFree((void*)damage_snapshot_original,0,MEM_RELEASE); VirtualFree(image,0,MEM_RELEASE);
    puts("PASS snapshot: install gates/relocation, duplicate refusal, 0x200/0x190 snapshots, stack params, unreadable arg4, unchanged input, lock skip, last error");
}
