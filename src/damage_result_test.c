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
    CHECK(damage_result_start()==-7);
    unsigned char *image=VirtualAlloc(NULL,PIN_SIZE_OF_IMAGE,MEM_RESERVE,PAGE_NOACCESS); CHECK(image);
    CHECK(VirtualAlloc(image+(PIN_ResultConverter_convert_RVA&~0xfffULL),8192,MEM_COMMIT,PAGE_READWRITE));
    unsigned char *target=image+PIN_ResultConverter_convert_RVA; memcpy(target,result_fingerprint,64); /* src/pins.h */
    module_base=(uintptr_t)image;damage_probe_original=1;
    target[30]^=1;CHECK(damage_result_start()==-3);CHECK(!damage_result_original&&result_output==INVALID_HANDLE_VALUE);
    CHECK(target[0]==0x55);target[30]^=1;
    CHECK(damage_result_start()==1); CHECK(damage_result_start()==-6);
    CHECK(!memcmp((void*)damage_result_original,result_fingerprint,12));
    uintptr_t continuation;memcpy(&continuation,(unsigned char*)damage_result_original+18,8);CHECK(continuation==(uintptr_t)target+12);
    CHECK(target[0]==0x48&&target[10]==0xff&&target[11]==0xe0&&target[12]==0x48);
    char path[1024];CHECK(GetFinalPathNameByHandleA(result_output,path,sizeof(path),0));CloseHandle(result_output);CHECK(DeleteFileA(path));
    result_output=CreateFileA("damage-result-test.tmp",GENERIC_WRITE|GENERIC_READ,0,NULL,CREATE_ALWAYS,FILE_ATTRIBUTE_TEMPORARY,NULL);CHECK(result_output!=INVALID_HANDLE_VALUE);
    unsigned char result[PIN_DamageResult_dump_bytes]={0},context[0x50]={0},entity[0x80]={0},component[0x160]={0},str[0x14+400]={0};
    int len=200;memcpy(str+0x10,&len,4);for(int i=0;i<200;i++){str[0x14+i*2]='A';}
    uintptr_t sp=(uintptr_t)str;memcpy(result+PIN_DamageResult_strings_0,&sp,8); /* the first System.String field (src/pins.h) */
    float damage=4406.375f;memcpy(result+PIN_DamageResult_damage,&damage,4);result[PIN_DamageResult_crit]=2; /* damage / crit */
    unsigned char before[PIN_DamageResult_dump_bytes];memcpy(before,result,sizeof(result));
    /* Concrete layout: array payload, 24-byte entries, key pointer and float value. */
    unsigned char dictionary[0x50]={0},array[0x20+129*24]={0};
    uintptr_t arrayptr=(uintptr_t)array,dictptr=(uintptr_t)dictionary;
    uint64_t capacity=129;memcpy(dictionary+0x18,&arrayptr,8);memcpy(array+0x18,&capacity,8);
    for(int i=0;i<129;i++){memcpy(array+0x20+i*24+8,&sp,8);memcpy(array+0x20+i*24+16,&damage,4);}
    int32_t inactive=-1;memcpy(array+0x20+24,&inactive,4);
    memcpy(result+PIN_DamageResult_stat_dict,&dictptr,8); /* Dictionary<string,float> */
    /* a8: result+hit_names addresses the per-hit name object whose first and third string slots are
     * string pointers (the second null), and whose +0x30 carries a marker so the raw 0x50-byte
     * snapshot is checked too (the string slots end at +0x30 on 3.3.2-3.3.4). */
    unsigned char a8obj[0x50]={0}; memcpy(a8obj+PIN_HitNames_strings_0,&sp,8); memcpy(a8obj+PIN_HitNames_strings_2,&sp,8); memset(a8obj+0x30,0xEE,8);
    uintptr_t a8ptr=(uintptr_t)a8obj; memcpy(result+PIN_DamageResult_hit_names,&a8ptr,8);
    /* tags: result+attack_tags -> List<String> (_items +0x10, _size +0x18); the items array keeps
     * its capacity at +0x18 and its string pointers from +0x20. 20 slots alternate Buff / Abloom. */
    unsigned char buff[0x14+8]={0},abloom[0x14+12]={0}; int four=4,six=6; memcpy(buff+0x10,&four,4); memcpy(abloom+0x10,&six,4);
    for(int i=0;i<4;i++)buff[0x14+i*2]="Buff"[i]; for(int i=0;i<6;i++)abloom[0x14+i*2]="Abloom"[i];
    unsigned char tagarray[0x20+20*8]={0},taglist[0x20]={0}; uint64_t tagcap=20; memcpy(tagarray+0x18,&tagcap,8);
    for(int i=0;i<20;i++){uintptr_t s=(uintptr_t)(i%2?abloom:buff);memcpy(tagarray+0x20+i*8,&s,8);}
    uintptr_t tagarrayptr=(uintptr_t)tagarray,taglistptr=(uintptr_t)taglist; int32_t tagsize=2;
    memcpy(taglist+0x10,&tagarrayptr,8); memcpy(taglist+0x18,&tagsize,4); memcpy(result+PIN_DamageResult_attack_tags,&taglistptr,8);
    memcpy(before,result,sizeof(result));
    ProbeRegisters r={0};r.gpr[0]=(uintptr_t)context;r.gpr[1]=(uintptr_t)entity;r.gpr[2]=(uintptr_t)entity;r.gpr[3]=(uintptr_t)result;
    uint64_t stack[7]={0};stack[0]=module_base+0x134ed761;stack[5]=(uintptr_t)component;stack[6]=0x123456;
    SetLastError(4321);damage_result_record(&r,stack);CHECK(GetLastError()==4321&&result_sequence==1);CHECK(!memcmp(before,result,sizeof(result)));
    r.gpr[3]=1;damage_result_record(&r,stack);CHECK(result_sequence==2);
    AcquireSRWLockExclusive(&result_lock);damage_result_record(&r,stack);CHECK(result_sequence==2&&result_skipped==1);ReleaseSRWLockExclusive(&result_lock);
    SetFilePointer(result_output,0,NULL,FILE_BEGIN);static char text[260000];DWORD n;CHECK(ReadFile(result_output,text,sizeof(text)-1,&n,NULL));
    { char dumped[16]; snprintf(dumped,sizeof(dumped),"\t%d\t",PIN_DamageResult_dump_bytes); /* the whole result object */
      CHECK(strstr(text,dumped)&&strstr(text,"\t200\t384\t41004100")); }
    CHECK(strstr(text,"\t0x123456\t"));CHECK(strstr(text,"\t-1\t0\t"));
    CHECK(strstr(text,"\t129\t3072\t"));CHECK(strstr(text,"127:200:384:41004100"));
    CHECK(!strstr(text,"|128:200:")&&!strstr(text,"|1:200:"));
    { char want[160]; snprintf(want,sizeof(want),"\t0x%llx\t80\t",(unsigned long long)a8ptr); char *cell=strstr(text,want); CHECK(cell);
      cell+=strlen(want); CHECK(!memcmp(cell+0x30*2,"eeeeeeeeeeeeeeee",16)); /* raw a8 bytes */
      CHECK(!strncmp(cell+0x50*2,"\t200\t384\t41004100",17)); /* a8s18: 200 units, truncated to 192 */
      CHECK(strstr(cell+0x50*2+17,"\t-1\t0\t\t200\t384\t41004100")); } /* a8s20 null, a8s28 string */
    CHECK(strstr(text,"\thop1")==NULL&&strstr(text,"h2:")==NULL); /* schema-4 hop cells are gone */
    { unsigned char none[PIN_DamageResult_dump_bytes]={0}; float d=1.0f; memcpy(none+PIN_DamageResult_damage,&d,4); r.gpr[3]=(uintptr_t)none; damage_result_record(&r,stack); } /* a8 null: row still written */
    CHECK(result_sequence==3);
    CHECK(strstr(text,"\t2\t20\t0:4:8:4200750066006600|1:6:12:410062006c006f006f006d00|\t\t\t\t1\n")); /* tags, row 1; empty float_list / team_props / base_props; order 1 */
    /* 20 tags keep the first 16; a size beyond the array's capacity reads none; a null list is -1/-1. */
    r.gpr[3]=(uintptr_t)result; tagsize=20; memcpy(taglist+0x18,&tagsize,4); damage_result_record(&r,stack);
    tagsize=21; memcpy(taglist+0x18,&tagsize,4); damage_result_record(&r,stack); CHECK(result_sequence==5);
    SetFilePointer(result_output,0,NULL,FILE_BEGIN); static char again[520000]; CHECK(ReadFile(result_output,again,sizeof(again)-1,&n,NULL)); again[n]=0;
    { char *row=strstr(again,"\t20\t20\t0:4:"); CHECK(row); char *eol=strchr(row,'\n'); CHECK(eol); *eol=0;
      CHECK(strstr(row,"|15:6:12:410062006c006f006f006d00|")&&!strstr(row,"|16:")); *eol='\n'; }
    CHECK(strstr(again,"\t21\t20\t\t\t\t\t6\n")); CHECK(strstr(again,"\t0x0\t0\t\t-1\t-1\t\t\t\t\t4\n")); /* order 3 went to the lock-skipped call */
    CHECK(log_order==6);
    CloseHandle(result_output);DeleteFileA("damage-result-test.tmp");VirtualFree((void*)damage_result_original,0,MEM_RELEASE);VirtualFree(image,0,MEM_RELEASE);
    puts("PASS result: install gates/relocation, bounded snapshots, unreadable pointers, string truncation, unchanged inputs, lock skip, last error, tag list");
}
