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
#define CHECK(x) do {if(!(x)){printf("FAIL line %d: %s\n",__LINE__,#x);exit(1);}} while(0)
int main(void) {
    CHECK(damage_anomaly_start()==-7);
    unsigned char *image=VirtualAlloc(NULL,0x21591000,MEM_RESERVE,PAGE_NOACCESS); CHECK(image);
    CHECK(VirtualAlloc(image+(ANOMALY_RVA&~0xfff),4096,MEM_COMMIT,PAGE_READWRITE));
    unsigned char *target=image+ANOMALY_RVA; memcpy(target,anomaly_fingerprint,64);
    module_base=(uintptr_t)image; damage_probe_original=1;
    target[20]^=1; CHECK(damage_anomaly_start()==-3); CHECK(!damage_anomaly_original&&anomaly_output==INVALID_HANDLE_VALUE); CHECK(target[0]==0x41); target[20]^=1;
    CHECK(damage_anomaly_start()==1); CHECK(damage_anomaly_start()==-6);
    CHECK(!memcmp((void*)damage_anomaly_original,anomaly_fingerprint,12));
    uintptr_t continuation; memcpy(&continuation,(unsigned char*)damage_anomaly_original+18,8); CHECK(continuation==(uintptr_t)target+12);
    CHECK(target[0]==0x48&&target[10]==0xff&&target[11]==0xe0&&target[12]==0x44); /* byte 12 (movaps) untouched */
    char path[1024]; CHECK(GetFinalPathNameByHandleA(anomaly_output,path,sizeof(path),0)); CloseHandle(anomaly_output); CHECK(DeleteFileA(path));
    anomaly_output=CreateFileA("damage-anomaly-test.tmp",GENERIC_WRITE|GENERIC_READ,0,NULL,CREATE_ALWAYS,FILE_ATTRIBUTE_TEMPORARY,NULL); CHECK(anomaly_output!=INVALID_HANDLE_VALUE);
    /* Recorder: gauge (this) with cur/max/element/variants/entity, evt -> ctx -> result, result floats. */
    unsigned char self[ANOMALY_THIS_BYTES], evt[0x30], ctx[ANOMALY_CTX_BYTES], result[0x290];
    memset(self,0x5A,sizeof(self)); memset(evt,0x33,sizeof(evt)); memset(ctx,0xA5,sizeof(ctx)); memset(result,0,sizeof(result));
    float cur=1761.5f, max=1875.0f, f68=0.25f, req=115.625f, dmv=0.2068f; int32_t element=203, variant=0, variant2=7;
    memcpy(self+ANOMALY_THIS_CUR,&cur,4); memcpy(self+ANOMALY_THIS_MAX,&max,4); memcpy(self+ANOMALY_THIS_F68,&f68,4);
    memcpy(self+ANOMALY_THIS_ELEMENT,&element,4); memcpy(self+ANOMALY_THIS_VARIANT,&variant,4); memcpy(self+ANOMALY_THIS_VARIANT2,&variant2,4);
    uint64_t entity=0x7000deadbeef; memcpy(self+ANOMALY_THIS_ENTITY,&entity,8);
    uint64_t cp=(uint64_t)(uintptr_t)ctx; memcpy(evt+ANOMALY_EVT_CTX,&cp,8);
    uint64_t rp=(uint64_t)(uintptr_t)result; memcpy(ctx+ANOMALY_CTX_RESULT,&rp,8);
    memcpy(result+ANOMALY_RESULT_REQUESTED,&req,4); memcpy(result+ANOMALY_RESULT_DAZE_MV,&dmv,4);
    ProbeRegisters r={0}; r.gpr[0]=(uintptr_t)self; r.gpr[1]=(uintptr_t)evt;
    uint64_t stack[9]={0}; stack[0]=module_base+0x16094612;
    unsigned char before_bytes[ANOMALY_THIS_BYTES]; memcpy(before_bytes,self,sizeof(self));
    SetLastError(4321); damage_anomaly_record(&r,stack); CHECK(GetLastError()==4321&&anomaly_sequence==1); CHECK(!memcmp(before_bytes,self,sizeof(self)));
    r.gpr[1]=1; damage_anomaly_record(&r,stack); CHECK(anomaly_sequence==2); /* unreadable evt: ctx/result 0, result floats -1, gauge still read */
    r.gpr[0]=0; r.gpr[1]=0; damage_anomaly_record(&r,stack); CHECK(anomaly_sequence==3); /* null this and evt: nothing dereferenced */
    AcquireSRWLockExclusive(&anomaly_lock); damage_anomaly_record(&r,stack); CHECK(anomaly_sequence==3&&anomaly_skipped==1); ReleaseSRWLockExclusive(&anomaly_lock);
    SetFilePointer(anomaly_output,0,NULL,FILE_BEGIN); static char text[16384]; DWORD n; CHECK(ReadFile(anomaly_output,text,sizeof(text)-1,&n,NULL)); text[n]=0;
    { char want[320]; snprintf(want,sizeof(want),"\t0x16094612\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x7000deadbeef\t203\t0\t7\t1761.5\t1875\t0.25\t115.625\t0.206799999\t160\t",
        (unsigned long long)(uintptr_t)self,(unsigned long long)(uintptr_t)evt,(unsigned long long)(uintptr_t)ctx,(unsigned long long)(uintptr_t)result);
      char *cell=strstr(text,want); CHECK(cell); cell+=strlen(want);
      CHECK(!memcmp(cell,"5a5a5a5a",8)); CHECK(!memcmp(cell+ANOMALY_THIS_CUR*2,"0030dc44",8)); /* 1761.5f = 0x44dc3000 little-endian */
      CHECK(!strncmp(cell+ANOMALY_THIS_BYTES*2,"\t80\ta5a5a5a5",12)); }
    CHECK(strstr(text,"\t0x1\t0x0\t0x0\t0x7000deadbeef\t203\t0\t7\t1761.5\t1875\t0.25\t-1\t-1\t160\t")); /* second row: evt unreadable */
    CHECK(strstr(text,"\t0x0\t0x0\t0x0\t0x0\t0x0\t-1\t-1\t-1\t-1\t-1\t-1\t-1\t-1\t0\t\t0\t\n")); /* third row: null this/evt */
    CHECK(strstr(text,"\tthis_hex")==NULL); /* header not in the data rows */
    CloseHandle(anomaly_output); DeleteFileA("damage-anomaly-test.tmp");
    VirtualFree((void*)damage_anomaly_original,0,MEM_RELEASE); VirtualFree(image,0,MEM_RELEASE);
    puts("PASS anomaly: install gates/relocation, duplicate refusal, gauge/evt/ctx snapshots, result pointer and floats, unreadable evt, null this/evt, unchanged input, lock skip, last error");
}
