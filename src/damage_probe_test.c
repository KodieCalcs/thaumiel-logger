/* Standalone bridge test: deliberately destroy volatile registers in the recorder,
 * then verify all 18 mixed arguments and the floating-point return survive. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
uintptr_t damage_probe_original;
uintptr_t damage_numeric_original;
uintptr_t damage_event_original;
static int event_seen;
uintptr_t damage_enqueue_original;
uintptr_t damage_result_original;
static int result_seen;
uintptr_t damage_snapshot_original;
static int snapshot_seen;
uintptr_t damage_daze_original;
static int daze_seen;
uintptr_t damage_anomaly_original;
static int anomaly_seen;
void damage_anomaly_record(const uint64_t *r,const uint64_t *stack){ if(r[0]!=0xCCCC||r[1]!=0xDDDD) abort(); anomaly_seen++; __asm__ volatile("pxor %%xmm6, %%xmm6" ::: "xmm6"); }
extern uint64_t damage_anomaly_entry(uint64_t a,uint64_t b);
void damage_daze_record(const uint64_t *r,const uint64_t *stack){ if(r[0]!=0xAAAA||r[1]!=0xBBBB) abort(); daze_seen++; __asm__ volatile("pxor %%xmm2, %%xmm2" ::: "xmm2"); }
extern uint64_t damage_daze_entry(uint64_t a,uint64_t b);
void damage_snapshot_record(const uint64_t *r,const uint64_t *stack){ if(r[0]!=0x1111||r[1]!=0x2222||r[2]!=0x3333||r[3]!=0x4444||stack[5]!=0x5555||stack[6]!=0x6666) abort(); snapshot_seen++; }
extern uint64_t damage_snapshot_entry(uint64_t a,uint64_t b,uint64_t c,uint64_t d,uint64_t e,uint64_t f);
void damage_result_record(const uint64_t *r,const uint64_t *stack){
    if(r[0]!=0x1111||r[1]!=0x2222||r[2]!=0x3333||r[3]!=0x4444||stack[5]!=0x5555||stack[6]!=0x6666) abort();
    result_seen++;
    __asm__ volatile("pxor %%xmm0, %%xmm0; pxor %%xmm1, %%xmm1" ::: "xmm0","xmm1");
}
static int enqueue_seen;
static int seen;
static int numeric_seen;
static void require(int condition){if(!condition){puts("FAIL");exit(1);}}
void damage_probe_record(const uint64_t *r,const uint64_t *stack){
    require(r[0]==11 && r[2]==33);
    double d; memcpy(&d,&r[10],8);require(d==22.5); /* XMM1 at rel80 */
    float f; memcpy(&f,&r[14],4);require(f==44.25f); /* XMM3 at rel112 */
    require(stack[5]==55 && stack[18]==1818);
    seen++;
    __asm__ volatile("pxor %%xmm0, %%xmm0; pxor %%xmm1, %%xmm1; pxor %%xmm2, %%xmm2; pxor %%xmm3, %%xmm3; pxor %%xmm4, %%xmm4; pxor %%xmm5, %%xmm5"
        ::: "xmm0","xmm1","xmm2","xmm3","xmm4","xmm5");
    SetLastError(123); /* Real callback restores this; exercise ordinary external calls here. */
}
#define PARAMS uint64_t a,double b,uint64_t c,float d,uint64_t e,double f,uint64_t g,double h,uint64_t i,double j,uint64_t k,double l,uint64_t m,double n,uint64_t o,double p,uint64_t q,uint64_t method
extern double damage_probe_entry(PARAMS);
static double original(PARAMS){
    require(a==11&&b==22.5&&c==33&&d==44.25f&&e==55&&f==66.5&&g==77&&h==88.5&&i==99);
    require(j==1010.5&&k==1111&&l==1212.5&&m==1313&&n==1414.5&&o==1515&&p==1616.5&&q==1717&&method==1818);
    return 9876.125;
}
extern float damage_numeric_entry(uint64_t self,float input,uint32_t category,float auxiliary,uint64_t method);
static float numeric_original(uint64_t self,float input,uint32_t category,float auxiliary,uint64_t method){
    require(self==0x12345678&&input==3652.25f&&category==7&&auxiliary==0.125f&&method==0xabcdef);
    return 4567.5f;
}
extern uint64_t damage_event_entry(uint64_t self,uint64_t ev,uint64_t target,uint64_t view,uint64_t vec3,uint64_t method);
extern uint64_t damage_result_entry(uint64_t context,uint64_t e1,uint64_t e2,uint64_t result,uint64_t component,uint64_t output);
static uint64_t daze_original(uint64_t self,uint64_t ctx){ require(self==0xAAAA&&ctx==0xBBBB);return 0x7777; }
static uint64_t anomaly_original(uint64_t self,uint64_t evt){ require(self==0xCCCC&&evt==0xDDDD);return 0x7777; }
static uint64_t event_original(uint64_t self,uint64_t ev,uint64_t target,uint64_t view,uint64_t vec3,uint64_t method){
    require(self==0x1111&&ev==0x2222&&target==0x3333&&view==0x4444&&vec3==0x5555&&method==0x6666);return 0x7777;
}
void damage_event_record(const uint64_t *r,const uint64_t *stack){
    require(r[0]==0x1111&&r[1]==0x2222&&r[2]==0x3333&&r[3]==0x4444&&stack[5]==0x5555&&stack[6]==0x6666);event_seen++;
    __asm__ volatile("pxor %%xmm0, %%xmm0; pxor %%xmm1, %%xmm1" ::: "xmm0","xmm1");
}
extern uint64_t damage_enqueue_entry(uint64_t ev,uint64_t method);
static uint64_t enqueue_original(uint64_t ev,uint64_t method){require(ev==0x9999&&method==0x8888);return 0x7777;}
void damage_enqueue_record(const uint64_t *r,const uint64_t *stack){require(r[0]==0x9999&&r[1]==0x8888);enqueue_seen++;}
void damage_numeric_record(const uint64_t *r,const uint64_t *stack){
    require(r[0]==0x12345678&&(uint32_t)r[2]==7&&stack[5]==0xabcdef);
    float input,auxiliary;memcpy(&input,&r[10],4);memcpy(&auxiliary,&r[14],4);
    require(input==3652.25f&&auxiliary==0.125f);numeric_seen++;
    __asm__ volatile("pxor %%xmm0, %%xmm0; pxor %%xmm1, %%xmm1; pxor %%xmm2, %%xmm2; pxor %%xmm3, %%xmm3; pxor %%xmm4, %%xmm4; pxor %%xmm5, %%xmm5"
        ::: "xmm0","xmm1","xmm2","xmm3","xmm4","xmm5");
}
int main(void){
    /* Exercise the actual eight-push relocation, then original continuation.
     * Synthetic target pops those registers and jumps to the argument oracle. */
    unsigned char *target=VirtualAlloc(NULL,128,MEM_COMMIT|MEM_RESERVE,PAGE_EXECUTE_READWRITE);
    require(target!=NULL);
    const unsigned char pushes[]={0x41,0x57,0x41,0x56,0x41,0x55,0x41,0x54,0x56,0x57,0x55,0x53};
    const unsigned char pops[]={0x5b,0x5d,0x5f,0x5e,0x41,0x5c,0x41,0x5d,0x41,0x5e,0x41,0x5f};
    memcpy(target,pushes,12);memcpy(target+12,pops,12);
    memcpy(target+24,"\xff\x25\0\0\0\0",6);
    uintptr_t oracle=(uintptr_t)&original;memcpy(target+30,&oracle,8);
    unsigned char *stub=target+64;memcpy(stub,pushes,12);memcpy(stub+12,"\xff\x25\0\0\0\0",6);
    uintptr_t continuation=(uintptr_t)target+12;memcpy(stub+18,&continuation,8);
    damage_probe_original=(uintptr_t)stub;
    FlushInstructionCache(GetCurrentProcess(),target,128);
    for(int i=0;i<10000;i++)require(damage_probe_entry(11,22.5,33,44.25f,55,66.5,77,88.5,99,1010.5,1111,1212.5,1313,1414.5,1515,1616.5,1717,1818)==9876.125);
    require(seen==10000);VirtualFree(target,0,MEM_RELEASE);
    /* Numeric target has a DIFFERENT 16-byte prologue with stack allocation and XMM saves. */
    target=VirtualAlloc(NULL,128,MEM_COMMIT|MEM_RESERVE,PAGE_EXECUTE_READWRITE);require(target!=NULL);
    const unsigned char numeric_pushes[]={0x56,0x57,0x48,0x83,0xec,0x58,0x0f,0x29,0x7c,0x24,0x40,0x0f,0x29,0x74,0x24,0x30};
    const unsigned char numeric_pops[]={0x0f,0x28,0x74,0x24,0x30,0x0f,0x28,0x7c,0x24,0x40,0x48,0x83,0xc4,0x58,0x5f,0x5e};
    memcpy(target,numeric_pushes,16);memcpy(target+16,numeric_pops,16);
    memcpy(target+32,"\xff\x25\0\0\0\0",6);oracle=(uintptr_t)&numeric_original;memcpy(target+38,&oracle,8);
    stub=target+64;memcpy(stub,numeric_pushes,16);memcpy(stub+16,"\xff\x25\0\0\0\0",6);
    continuation=(uintptr_t)target+16;memcpy(stub+22,&continuation,8);damage_numeric_original=(uintptr_t)stub;
    FlushInstructionCache(GetCurrentProcess(),target,128);
    for(int i=0;i<10000;i++)require(damage_numeric_entry(0x12345678,3652.25f,7,0.125f,0xabcdef)==4567.5f);
    require(numeric_seen==10000);VirtualFree(target,0,MEM_RELEASE);
    /* Event target: same eight-push prologue as the string probe, integer args + one stack arg. */
    target=VirtualAlloc(NULL,128,MEM_COMMIT|MEM_RESERVE,PAGE_EXECUTE_READWRITE);require(target!=NULL);
    memcpy(target,pushes,12);memcpy(target+12,pops,12);memcpy(target+24,"\xff\x25\0\0\0\0",6);
    oracle=(uintptr_t)&event_original;memcpy(target+30,&oracle,8);
    stub=target+64;memcpy(stub,pushes,12);memcpy(stub+12,"\xff\x25\0\0\0\0",6);
    continuation=(uintptr_t)target+12;memcpy(stub+18,&continuation,8);damage_event_original=(uintptr_t)stub;
    FlushInstructionCache(GetCurrentProcess(),target,128);
    for(int i=0;i<10000;i++)require(damage_event_entry(0x1111,0x2222,0x3333,0x4444,0x5555,0x6666)==0x7777);
    require(event_seen==10000);VirtualFree(target,0,MEM_RELEASE);
    /* Result converter has a different order of the eight pushes. */
    target=VirtualAlloc(NULL,128,MEM_COMMIT|MEM_RESERVE,PAGE_EXECUTE_READWRITE);require(target!=NULL);
    const unsigned char result_pushes[]={0x55,0x41,0x57,0x41,0x56,0x41,0x55,0x41,0x54,0x56,0x57,0x53};
    const unsigned char result_pops[]={0x5b,0x5f,0x5e,0x41,0x5c,0x41,0x5d,0x41,0x5e,0x41,0x5f,0x5d};
    memcpy(target,result_pushes,12);memcpy(target+12,result_pops,12);memcpy(target+24,"\xff\x25\0\0\0\0",6);
    oracle=(uintptr_t)&event_original;memcpy(target+30,&oracle,8);
    stub=target+64;memcpy(stub,result_pushes,12);memcpy(stub+12,"\xff\x25\0\0\0\0",6);
    continuation=(uintptr_t)target+12;memcpy(stub+18,&continuation,8);damage_result_original=(uintptr_t)stub;
    FlushInstructionCache(GetCurrentProcess(),target,128);
    for(int i=0;i<10000;i++)require(damage_result_entry(0x1111,0x2222,0x3333,0x4444,0x5555,0x6666)==0x7777);
    require(result_seen==10000);VirtualFree(target,0,MEM_RELEASE);
    /* Enqueue target: `push rsi; sub rsp,0x90; mov rsi,rcx; cmp byte ptr [rip+d],0` relocated 18 bytes.
     * The synthetic body then undoes the prologue and jumps to the oracle. The cmp reads a byte we
     * place after the code, so a wrong re-base would read garbage; we set it so the flags don't matter. */
    target=VirtualAlloc(NULL,256,MEM_COMMIT|MEM_RESERVE,PAGE_EXECUTE_READWRITE);require(target!=NULL);
    const unsigned char qpro[]={0x56,0x48,0x81,0xec,0x90,0x00,0x00,0x00,0x48,0x89,0xce,0x80,0x3d,0,0,0,0,0x00};
    memcpy(target,qpro,18);
    { int32_t d=(int32_t)((target+200)-(target+18)); memcpy(target+13,&d,4); } /* cmp reads target+200 */
    const unsigned char qepi[]={0x48,0x81,0xc4,0x90,0x00,0x00,0x00,0x5e}; /* add rsp,0x90; pop rsi */
    memcpy(target+18,qepi,8);memcpy(target+26,"\xff\x25\0\0\0\0",6);oracle=(uintptr_t)&enqueue_original;memcpy(target+32,&oracle,8);
    stub=target+64;memcpy(stub,target,18);
    { int32_t d=(int32_t)((target+200)-(stub+18)); memcpy(stub+13,&d,4); } /* re-based exactly as the installer does */
    memcpy(stub+18,"\xff\x25\0\0\0\0",6);continuation=(uintptr_t)target+18;memcpy(stub+24,&continuation,8);damage_enqueue_original=(uintptr_t)stub;
    FlushInstructionCache(GetCurrentProcess(),target,256);
    for(int i=0;i<10000;i++)require(damage_enqueue_entry(0x9999,0x8888)==0x7777);
    require(enqueue_seen==10000);VirtualFree(target,0,MEM_RELEASE);
    /* Snapshot factory target: the same eight pushes as the string probe, integer args + stack args. */
    target=VirtualAlloc(NULL,128,MEM_COMMIT|MEM_RESERVE,PAGE_EXECUTE_READWRITE);require(target!=NULL);
    memcpy(target,pushes,12);memcpy(target+12,pops,12);memcpy(target+24,"\xff\x25\0\0\0\0",6);
    oracle=(uintptr_t)&event_original;memcpy(target+30,&oracle,8);
    stub=target+64;memcpy(stub,pushes,12);memcpy(stub+12,"\xff\x25\0\0\0\0",6);
    continuation=(uintptr_t)target+12;memcpy(stub+18,&continuation,8);damage_snapshot_original=(uintptr_t)stub;
    FlushInstructionCache(GetCurrentProcess(),target,128);
    for(int i=0;i<10000;i++)require(damage_snapshot_entry(0x1111,0x2222,0x3333,0x4444,0x5555,0x6666)==0x7777);
    require(snapshot_seen==10000);VirtualFree(target,0,MEM_RELEASE);
    /* Daze target: the same eight pushes (this, ctx); the recorder clobbers xmm2 on purpose. */
    target=VirtualAlloc(NULL,128,MEM_COMMIT|MEM_RESERVE,PAGE_EXECUTE_READWRITE);require(target!=NULL);
    memcpy(target,pushes,12);memcpy(target+12,pops,12);memcpy(target+24,"\xff\x25\0\0\0\0",6);
    oracle=(uintptr_t)&daze_original;memcpy(target+30,&oracle,8);
    stub=target+64;memcpy(stub,pushes,12);memcpy(stub+12,"\xff\x25\0\0\0\0",6);
    continuation=(uintptr_t)target+12;memcpy(stub+18,&continuation,8);damage_daze_original=(uintptr_t)stub;
    FlushInstructionCache(GetCurrentProcess(),target,128);
    for(int i=0;i<10000;i++)require(damage_daze_entry(0xAAAA,0xBBBB)==0x7777);
    require(daze_seen==10000);VirtualFree(target,0,MEM_RELEASE);
    /* Anomaly target: six pushes + sub rsp,0x78 relocated as one 12-byte block (this, evt); the recorder clobbers xmm6 on purpose. */
    { static const unsigned char six[12]={0x41,0x57,0x41,0x56,0x56,0x57,0x55,0x53,0x48,0x83,0xec,0x78};
      static const unsigned char unsix[12]={0x48,0x83,0xc4,0x78,0x5b,0x5d,0x5f,0x5e,0x41,0x5e,0x41,0x5f}; /* add rsp,0x78; pop rbx,rbp,rdi,rsi,r14,r15 */
      target=VirtualAlloc(NULL,128,MEM_COMMIT|MEM_RESERVE,PAGE_EXECUTE_READWRITE);require(target!=NULL);
      memcpy(target,six,12);memcpy(target+12,unsix,12);memcpy(target+24,"\xff\x25\0\0\0\0",6);
      oracle=(uintptr_t)&anomaly_original;memcpy(target+30,&oracle,8);
      stub=target+64;memcpy(stub,six,12);memcpy(stub+12,"\xff\x25\0\0\0\0",6);
      continuation=(uintptr_t)target+12;memcpy(stub+18,&continuation,8);damage_anomaly_original=(uintptr_t)stub;
      FlushInstructionCache(GetCurrentProcess(),target,128);
      for(int i=0;i<10000;i++)require(damage_anomaly_entry(0xCCCC,0xDDDD)==0x7777);
      require(anomaly_seen==10000);VirtualFree(target,0,MEM_RELEASE); }
    puts("PASS: 10000 calls each through all eight bridges; relocated prologues, mixed inputs and return values preserved");
}
