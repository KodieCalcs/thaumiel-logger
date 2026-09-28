/* Windows x64 observation bridge. Original stack and return address are untouched.
 * 32 bytes shadow space, seven volatile GPRs, padding, six volatile XMMs.
 * No guessed C signature for the target; tail jump preserves its return type too. */
.intel_syntax noprefix
.text
.macro PROBE_BRIDGE entry, recorder, original
.globl \entry
.def \entry; .scl 2; .type 32; .endef
.seh_proc \entry
\entry:
    pushfq
    .seh_stackalloc 8
    sub rsp, 256
    .seh_stackalloc 256
    .seh_endprologue
    mov [rsp+32], rcx
    mov [rsp+40], rdx
    mov [rsp+48], r8
    mov [rsp+56], r9
    mov [rsp+64], rax
    mov [rsp+72], r10
    mov [rsp+80], r11
    movdqu [rsp+96], xmm0
    movdqu [rsp+112], xmm1
    movdqu [rsp+128], xmm2
    movdqu [rsp+144], xmm3
    movdqu [rsp+160], xmm4
    movdqu [rsp+176], xmm5
    stmxcsr [rsp+192]
    lea rcx, [rsp+32]
    lea rdx, [rsp+264]
    call \recorder
    ldmxcsr [rsp+192]
    movdqu xmm0, [rsp+96]
    movdqu xmm1, [rsp+112]
    movdqu xmm2, [rsp+128]
    movdqu xmm3, [rsp+144]
    movdqu xmm4, [rsp+160]
    movdqu xmm5, [rsp+176]
    mov rcx, [rsp+32]
    mov rdx, [rsp+40]
    mov r8, [rsp+48]
    mov r9, [rsp+56]
    mov rax, [rsp+64]
    mov r10, [rsp+72]
    mov r11, [rsp+80]
    add rsp, 256
    popfq
    jmp qword ptr [rip+\original]
.seh_endproc
.endm

PROBE_BRIDGE damage_probe_entry, damage_probe_record, damage_probe_original
PROBE_BRIDGE damage_numeric_entry, damage_numeric_record, damage_numeric_original
PROBE_BRIDGE damage_event_entry, damage_event_record, damage_event_original
PROBE_BRIDGE damage_enqueue_entry, damage_enqueue_record, damage_enqueue_original
PROBE_BRIDGE damage_result_entry, damage_result_record, damage_result_original
PROBE_BRIDGE damage_snapshot_entry, damage_snapshot_record, damage_snapshot_original
PROBE_BRIDGE damage_daze_entry, damage_daze_record, damage_daze_original
PROBE_BRIDGE damage_anomaly_entry, damage_anomaly_record, damage_anomaly_original
