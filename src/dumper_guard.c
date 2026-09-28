#include <windows.h>
#include <stdint.h>
// Catch only synchronous faults from the dumper callback, never game threads.
static int record_exception(EXCEPTION_POINTERS *p, uint32_t *code, uintptr_t *address) {
    DWORD value = p->ExceptionRecord->ExceptionCode;
    if (value != EXCEPTION_ACCESS_VIOLATION && value != EXCEPTION_ILLEGAL_INSTRUCTION &&
        value != EXCEPTION_INT_DIVIDE_BY_ZERO && value != EXCEPTION_IN_PAGE_ERROR)
        return EXCEPTION_CONTINUE_SEARCH;
    *code = value;
    *address = (uintptr_t)p->ExceptionRecord->ExceptionAddress;
    return EXCEPTION_EXECUTE_HANDLER;
}
int dumper_guard(void (*callback)(void), uint32_t *code, uintptr_t *address) {
    __try { callback(); return 1; }
    __except(record_exception(GetExceptionInformation(), code, address)) { return 0; }
}
