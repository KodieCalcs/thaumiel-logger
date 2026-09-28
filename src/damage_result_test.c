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
    CHECK(damage_result_start()==-7);
    unsigned char *image=VirtualAlloc(NULL,0x21591000,MEM_RESERVE,PAGE_NOACCESS); CHECK(image);
    CHECK(VirtualAlloc(image+0x19bf3000,4096,MEM_COMMIT,PAGE_READWRITE));
    unsigned char *target=image+0x19bf3530; memcpy(target,result_fingerprint,64);
    module_base=(uintptr_t)image;damage_probe_original=1;
    target[30]^=1;CHECK(damage_result_start()==-3);CHECK(!damage_result_original&&result_output==INVALID_HANDLE_VALUE);
    CHECK(target[0]==0x55);target[30]^=1;
    CHECK(damage_result_start()==1); CHECK(damage_result_start()==-6);
    CHECK(!memcmp((void*)damage_result_original,result_fingerprint,12));
    uintptr_t continuation;memcpy(&continuation,(unsigned char*)damage_result_original+18,8);CHECK(continuation==(uintptr_t)target+12);
    CHECK(target[0]==0x48&&target[10]==0xff&&target[11]==0xe0&&target[12]==0x48);
    char path[1024];CHECK(GetFinalPathNameByHandleA(result_output,path,sizeof(path),0));CloseHandle(result_output);CHECK(DeleteFileA(path));
    result_output=CreateFileA("damage-result-test.tmp",GENERIC_WRITE|GENERIC_READ,0,NULL,CREATE_ALWAYS,FILE_ATTRIBUTE_TEMPORARY,NULL);CHECK(result_output!=INVALID_HANDLE_VALUE);
    unsigned char result[0x2b0]={0},context[0x50]={0},entity[0x80]={0},component[0x160]={0},str[0x14+400]={0};
    int len=200;memcpy(str+0x10,&len,4);for(int i=0;i<200;i++){str[0x14+i*2]='A';}
    uintptr_t sp=(uintptr_t)str;memcpy(result+0x10,&sp,8); /* 3.3.4: first System.String field */
    float damage=4406.375f;memcpy(result+0x118,&damage,4);result[0x19c]=2; /* 3.3.4 damage / crit */
    unsigned char before[0x2b0];memcpy(before,result,sizeof(result));
    /* Concrete layout: array payload, 24-byte entries, key pointer and float value. */
    unsigned char dictionary[0x50]={0},array[0x20+129*24]={0};
    uintptr_t arrayptr=(uintptr_t)array,dictptr=(uintptr_t)dictionary;
    uint64_t capacity=129;memcpy(dictionary+0x18,&arrayptr,8);memcpy(array+0x18,&capacity,8);
    for(int i=0;i<129;i++){memcpy(array+0x20+i*24+8,&sp,8);memcpy(array+0x20+i*24+16,&damage,4);}
    int32_t inactive=-1;memcpy(array+0x20+24,&inactive,4);
    memcpy(result+0xb0,&dictptr,8); /* 3.3.4: Dictionary<string,float> */
    /* a8 (3.3.4): result+0x80 addresses the per-hit name object whose +0x18 and +0x28 are string pointers
     * (+0x20 null), and whose +0x30 carries a marker so the raw 0x50-byte snapshot is checked too. */
    unsigned char a8obj[0x50]={0}; memcpy(a8obj+0x18,&sp,8); memcpy(a8obj+0x28,&sp,8); memset(a8obj+0x30,0xEE,8);
    uintptr_t a8ptr=(uintptr_t)a8obj; memcpy(result+0x80,&a8ptr,8);
    memcpy(before,result,sizeof(result));
    ProbeRegisters r={0};r.gpr[0]=(uintptr_t)context;r.gpr[1]=(uintptr_t)entity;r.gpr[2]=(uintptr_t)entity;r.gpr[3]=(uintptr_t)result;
    uint64_t stack[7]={0};stack[0]=module_base+0x134ed761;stack[5]=(uintptr_t)component;stack[6]=0x123456;
    SetLastError(4321);damage_result_record(&r,stack);CHECK(GetLastError()==4321&&result_sequence==1);CHECK(!memcmp(before,result,sizeof(result)));
    r.gpr[3]=1;damage_result_record(&r,stack);CHECK(result_sequence==2);
    AcquireSRWLockExclusive(&result_lock);damage_result_record(&r,stack);CHECK(result_sequence==2&&result_skipped==1);ReleaseSRWLockExclusive(&result_lock);
    SetFilePointer(result_output,0,NULL,FILE_BEGIN);static char text[260000];DWORD n;CHECK(ReadFile(result_output,text,sizeof(text)-1,&n,NULL));
    CHECK(strstr(text,"\t688\t")&&strstr(text,"\t200\t384\t41004100"));CHECK(strstr(text,"\t0x123456\t"));CHECK(strstr(text,"\t-1\t0\t"));
    CHECK(strstr(text,"\t129\t3072\t"));CHECK(strstr(text,"127:200:384:41004100"));
    CHECK(!strstr(text,"|128:200:")&&!strstr(text,"|1:200:"));
    { char want[160]; snprintf(want,sizeof(want),"\t0x%llx\t80\t",(unsigned long long)a8ptr); char *cell=strstr(text,want); CHECK(cell);
      cell+=strlen(want); CHECK(!memcmp(cell+0x30*2,"eeeeeeeeeeeeeeee",16)); /* raw a8 bytes */
      CHECK(!strncmp(cell+0x50*2,"\t200\t384\t41004100",17)); /* a8s18: 200 units, truncated to 192 */
      CHECK(strstr(cell+0x50*2+17,"\t-1\t0\t\t200\t384\t41004100")); } /* a8s20 null, a8s28 string */
    CHECK(strstr(text,"\thop1")==NULL&&strstr(text,"h2:")==NULL); /* schema-4 hop cells are gone */
    { unsigned char none[0x2b0]={0}; float d=1.0f; memcpy(none+0x118,&d,4); r.gpr[3]=(uintptr_t)none; damage_result_record(&r,stack); } /* a8 null: row still written */
    CHECK(result_sequence==3);
    CloseHandle(result_output);DeleteFileA("damage-result-test.tmp");VirtualFree((void*)damage_result_original,0,MEM_RELEASE);VirtualFree(image,0,MEM_RELEASE);
    puts("PASS result: install gates/relocation, bounded snapshots, unreadable pointers, string truncation, unchanged inputs, lock skip, last error");
}
