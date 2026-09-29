/* Test actual numeric installer against reserved synthetic module memory; no game needed. */
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
static void check(int ok){if(!ok){puts("FAIL installer");exit(1);}}
int main(void){
    check(damage_numeric_start()==-7);check(damage_event_start()==-7);check(damage_enqueue_start()==-7); /* none installs before the string probe */
    unsigned char *image=VirtualAlloc(NULL,0x21591000,MEM_RESERVE,PAGE_NOACCESS);check(image!=NULL);
    unsigned char *page=VirtualAlloc(image+0x17184000,4096,MEM_COMMIT,PAGE_READWRITE);check(page!=NULL);
    unsigned char *target=image+0x17184100;memcpy(target,numeric_fingerprint,64);
    module_base=(uintptr_t)image;damage_probe_original=1;
    target[20]^=1;check(damage_numeric_start()==-3);check(damage_numeric_original==0&&numeric_output==INVALID_HANDLE_VALUE);
    check(target[0]==0x56);target[20]^=1;
    check(damage_numeric_start()==1);
    check(target[0]==0x48&&target[1]==0xb8&&target[10]==0xff&&target[11]==0xe0);
    for(int i=12;i<16;i++)check(target[i]==0x90);
    check(!memcmp((void*)damage_numeric_original,numeric_fingerprint,16));
    uintptr_t continuation;memcpy(&continuation,(unsigned char*)damage_numeric_original+22,8);check(continuation==(uintptr_t)target+16);
    check(damage_numeric_start()==-6);
    char output_path[1024];DWORD count=GetFinalPathNameByHandleA(numeric_output,output_path,sizeof(output_path),0);check(count>0&&count<sizeof(output_path));
    CloseHandle(numeric_output);DeleteFileA(output_path);
    VirtualFree((void*)damage_numeric_original,0,MEM_RELEASE);
    /* Event probe: 12-byte patch (eight pushes), fingerprint refusal, duplicate refusal. */
    unsigned char *epage=VirtualAlloc(image+0x14b10000,4096,MEM_COMMIT,PAGE_READWRITE);check(epage!=NULL);
    unsigned char *etarget=image+0x14b106e0;memcpy(etarget,event_fingerprint,64);
    etarget[30]^=1;check(damage_event_start()==-3);check(damage_event_original==0&&event_output==INVALID_HANDLE_VALUE);
    check(etarget[0]==0x41);etarget[30]^=1;
    check(damage_event_start()==1);
    check(etarget[0]==0x48&&etarget[1]==0xb8&&etarget[10]==0xff&&etarget[11]==0xe0&&etarget[12]==0x48&&etarget[13]==0x81);
    check(!memcmp((void*)damage_event_original,event_fingerprint,12));
    memcpy(&continuation,(unsigned char*)damage_event_original+18,8);check(continuation==(uintptr_t)etarget+12);
    check(damage_event_start()==-6);
    count=GetFinalPathNameByHandleA(event_output,output_path,sizeof(output_path),0);check(count>0&&count<sizeof(output_path));
    CloseHandle(event_output);DeleteFileA(output_path);VirtualFree((void*)damage_event_original,0,MEM_RELEASE);
    /* Enqueue probe: 18-byte relocation with one RIP-relative cmp re-based into the stub. */
    unsigned char *qpage=VirtualAlloc(image+0x133d4000,8192,MEM_COMMIT,PAGE_READWRITE);check(qpage!=NULL);
    unsigned char *qtarget=image+0x133d4590;memcpy(qtarget,enqueue_fingerprint,64);
    qtarget[40]^=1;check(damage_enqueue_start()==-3);check(damage_enqueue_original==0&&enqueue_output==INVALID_HANDLE_VALUE);
    check(qtarget[0]==0x56);qtarget[40]^=1;
    check(damage_enqueue_start()==1);
    check(qtarget[0]==0x48&&qtarget[1]==0xb8&&qtarget[10]==0xff&&qtarget[11]==0xe0);
    for(int i=12;i<18;i++)check(qtarget[i]==0x90);
    check(qtarget[18]==0x0f&&qtarget[19]==0x84); /* the instruction after the patched region is intact */
    {   const unsigned char *qstub=(const unsigned char*)damage_enqueue_original;
        check(!memcmp(qstub,enqueue_fingerprint,13)&&qstub[17]==enqueue_fingerprint[17]); /* bytes outside disp32 unchanged */
        int32_t od,nd;memcpy(&od,enqueue_fingerprint+13,4);memcpy(&nd,qstub+13,4);
        check((uintptr_t)qtarget+18+(intptr_t)od==(uintptr_t)qstub+18+(intptr_t)nd); /* same absolute target */
        memcpy(&continuation,qstub+24,8);check(continuation==(uintptr_t)qtarget+18);
        check(qstub[18]==0xff&&qstub[19]==0x25);
        { intptr_t dist=(intptr_t)qstub-(intptr_t)qtarget; check(dist<0x7FFFFFFFLL&&dist>-0x7FFFFFFFLL); } /* stub reachable by a re-based disp32 */
    }
    check(damage_enqueue_start()==-6);
    count=GetFinalPathNameByHandleA(enqueue_output,output_path,sizeof(output_path),0);check(count>0&&count<sizeof(output_path));
    CloseHandle(enqueue_output);DeleteFileA(output_path);VirtualFree((void*)damage_enqueue_original,0,MEM_RELEASE);
    VirtualFree(image,0,MEM_RELEASE);
    puts("PASS: prerequisite gate, wrong fingerprint leaves target untouched, 16/12/18-byte patch/stub with RIP re-base, duplicate refusal");
}
