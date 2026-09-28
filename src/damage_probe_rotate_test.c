/* Battle rotation (capture.zig -> damage_probe_rotate): every open probe file is closed and reopened
 * in the new battle folder with its header, the clock origin moves, a probe that never installed
 * stays closed, and the status file follows the session folder. Installs the result probe against
 * reserved synthetic module memory like damage_result_test.c; no game needed. */
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

static int count_files(const char *dir, const char *prefix, char *first, size_t first_len) {
    char pattern[MAX_PATH]; snprintf(pattern, sizeof(pattern), "%s%s*", dir, prefix);
    WIN32_FIND_DATAA fd; HANDLE h = FindFirstFileA(pattern, &fd); int n = 0;
    if (h == INVALID_HANDLE_VALUE) return 0;
    do { if (n == 0 && first) snprintf(first, first_len, "%s%s", dir, fd.cFileName); n++; } while (FindNextFileA(h, &fd));
    FindClose(h); return n;
}
static void read_head(const char *path, char *buf, size_t len) {
    HANDLE h = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL); CHECK(h != INVALID_HANDLE_VALUE);
    DWORD got = 0; CHECK(ReadFile(h, buf, (DWORD)len - 1, &got, NULL)); buf[got] = 0; CloseHandle(h);
}
static void remove_tree(const char *dir) {
    char pattern[MAX_PATH]; snprintf(pattern, sizeof(pattern), "%s*", dir);
    WIN32_FIND_DATAA fd; HANDLE h = FindFirstFileA(pattern, &fd);
    if (h != INVALID_HANDLE_VALUE) {
        do { if (fd.cFileName[0] != '.') { char p[MAX_PATH]; snprintf(p, sizeof(p), "%s%s", dir, fd.cFileName); DeleteFileA(p); } } while (FindNextFileA(h, &fd));
        FindClose(h);
    }
    RemoveDirectoryA(dir);
}

int main(void) {
    char root[MAX_PATH]; snprintf(root, sizeof(root), "rotate-test-%lu\\", GetCurrentProcessId());
    char b0[MAX_PATH], b1[MAX_PATH]; snprintf(b0, sizeof(b0), "%sbattle-0\\", root); snprintf(b1, sizeof(b1), "%sbattle-1\\", root);
    CHECK(CreateDirectoryA(root, NULL)); CHECK(CreateDirectoryA(b0, NULL)); CHECK(CreateDirectoryA(b1, NULL));
    damage_probe_set_dirs(root, b0);

    /* Status file lands in the session folder. */
    damage_probe_note_status("rotate-test", 1);
    char status[MAX_PATH]; CHECK(count_files(root, "damage-probe-status", status, sizeof(status)) == 1);
    char head[4096]; read_head(status, head, sizeof(head)); CHECK(strstr(head, "\trotate-test\t1\n"));

    /* Install the result probe: its file opens in battle-0 with the schema-5 header. */
    unsigned char *image = VirtualAlloc(NULL, 0x21591000, MEM_RESERVE, PAGE_NOACCESS); CHECK(image);
    CHECK(VirtualAlloc(image + 0x19bf3000, 4096, MEM_COMMIT, PAGE_READWRITE));
    unsigned char *target = image + 0x19bf3530; memcpy(target, result_fingerprint, 64);
    module_base = (uintptr_t)image; damage_probe_original = 1; started = 1000;
    CHECK(damage_result_start() == 1);
    char f0[MAX_PATH]; CHECK(count_files(b0, "damage-result-", f0, sizeof(f0)) == 1);
    read_head(f0, head, sizeof(head)); CHECK(!strncmp(head, result_header, strlen(result_header)));
    CHECK(result_output != INVALID_HANDLE_VALUE);
    CHECK(daze_output == INVALID_HANDLE_VALUE); /* never installed */

    /* Rotate: battle-1 gets a fresh result file with the same header, the handle now names it,
     * the clock moves, and the uninstalled probes stay closed (no stray files). */
    damage_probe_rotate(b1, 777777);
    CHECK(started == 777777);
    CHECK(result_output != INVALID_HANDLE_VALUE);
    char now_path[1024]; CHECK(GetFinalPathNameByHandleA(result_output, now_path, sizeof(now_path), 0)); CHECK(strstr(now_path, "battle-1\\damage-result-"));
    char f1[MAX_PATH]; CHECK(count_files(b1, "damage-result-", f1, sizeof(f1)) == 1);
    read_head(f1, head, sizeof(head)); CHECK(!strncmp(head, result_header, strlen(result_header)));
    CHECK(count_files(b1, "damage-", NULL, 0) == 1);
    CHECK(count_files(b0, "damage-", NULL, 0) == 1); /* nothing new in the old folder */
    CHECK(daze_output == INVALID_HANDLE_VALUE && anomaly_output == INVALID_HANDLE_VALUE && output == INVALID_HANDLE_VALUE);

    /* A row written after the rotation goes to the new file, timed from the new origin. */
    DWORD w; const char row[] = "1\t5\n"; CHECK(WriteFile(result_output, row, sizeof(row) - 1, &w, NULL));
    damage_probe_flush();
    read_head(f1, head, sizeof(head)); CHECK(strstr(head, "\n1\t5\n"));
    read_head(f0, head, sizeof(head)); CHECK(!strstr(head, "\n1\t5\n"));

    CloseHandle(result_output); result_output = INVALID_HANDLE_VALUE;
    VirtualFree((void *)damage_result_original, 0, MEM_RELEASE); VirtualFree(image, 0, MEM_RELEASE);
    remove_tree(b0); remove_tree(b1); remove_tree(root);
    puts("PASS rotate: status in the session folder, result file per battle folder with header, handle swap, clock origin, uninstalled probes stay closed, flush");
    return 0;
}
