//! v7: read Unity's already-populated API table; never call get_api_table.
//! CNBetaWin3.3.4 pins (2026-09-25): 105/194 RVAs matched offline (masked_match, block delta
//! 0x13a60 plus a delta-0 pass for the CRT stubs), 89 left at 0 for the first run to report;
//! code checks 63/65/152 re-read from the 3.3.4 binary, the other four dropped until the first
//! run reports their slots. Method unchanged from the 3.3.2 notes below.
//! CNBetaWin3.3.2 pins (2026-09-13): SizeOfImage from the PE header; Unity table offset found
//! statically via the `mov rax,[rip+..]`/`call [rip+..]` sites that reference it (two anchors
//! agree, 18 distinct slots called into it in both builds); RVAs = 3.3.0 + 0xD7A0 for the il2cpp
//! API block (127/194 verified byte-for-byte modulo relocations, the rest same slot with
//! per-build obfuscation changes), exact-signature matches for the runtime helpers outside it.
//! Seven trivial shared stubs could not be pinned statically and were taken from the first run
//! (entries pinned to 0 need only point into GameAssembly and are logged). Slots 118/119 swapped.
//! 3.3.0 pins: see git history (0e669bc..0fa3529).
const std = @import("std");
const capture = @import("capture.zig");
const w = std.os.windows;
const log = std.log.scoped(.dumper);
extern "kernel32" fn GetModuleHandleA(?[*:0]const u8) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn Sleep(u32) callconv(.winapi) void;
extern "kernel32" fn GetTickCount64() callconv(.winapi) u64;
extern "kernel32" fn GetCurrentProcess() callconv(.winapi) w.HANDLE;
extern "kernel32" fn ReadProcessMemory(w.HANDLE, ?*const anyopaque, [*]u8, usize, *usize) callconv(.winapi) w.BOOL;
extern "kernel32" fn CreateThread(?*anyopaque, usize, *const fn (?*anyopaque) callconv(.winapi) u32, ?*anyopaque, u32, ?*u32) callconv(.winapi) ?w.HANDLE;
extern "kernel32" fn CloseHandle(w.HANDLE) callconv(.winapi) w.BOOL;
extern "kernel32" fn CreateFileA([*:0]const u8, u32, u32, ?*anyopaque, u32, u32, ?w.HANDLE) callconv(.winapi) w.HANDLE;
extern "kernel32" fn WriteFile(w.HANDLE, [*]const u8, u32, *u32, ?*anyopaque) callconv(.winapi) w.BOOL;
extern "kernel32" fn FlushFileBuffers(w.HANDLE) callconv(.winapi) w.BOOL;
extern "kernel32" fn GetFileAttributesA([*:0]const u8) callconv(.winapi) u32;
extern fn dumper_guard(*const fn () callconv(.c) void, *u32, *usize) c_int;
const expected = @import("dumper-rvas.zon");
// UnityPlayer.dll + this = Unity's 194-entry il2cpp API table (3.3.0: 0x1f96648;
// 3.3.2/3.3.3: 0x1f9a6c8). MOVED 3.3.3 -> 3.3.4 (+0x1000, first move since 3.3.2): re-found
// 2026-09-25 by find_unity_table.mjs with anchors re-derived from the 3.3.3 OLD-line output.
// Both anchor sites agree on 0x1f9b6c8, and the reference count matches exactly (24434
// call [rip+..] sites into 18 distinct slots -- identical to 3.3.3).
const table_offset: usize = 0x1f9b6c8;
var table: [194]usize = undefined;
var table_valid = false;
var game: usize = 0;
var game_size: usize = 0;
var progress: ?w.HANDLE = null;
var output: ?w.HANDLE = null;
var stage: []const u8 = "startup";
var attached: usize = 0;
var failed = false;

fn peek(address: usize, out: []u8) bool {
    if (address == 0) return false;
    var got: usize = 0;
    return ReadProcessMemory(GetCurrentProcess(), @ptrFromInt(address), out.ptr, out.len, &got) != .FALSE and got == out.len;
}
fn word(address: usize) !usize {
    var bytes: [8]u8 = undefined;
    if (!peek(address, &bytes)) return error.UnreadablePointer;
    return std.mem.readInt(usize, &bytes, .little);
}
fn openFile(path: [*:0]const u8) !w.HANDLE {
    const handle = CreateFileA(path, 0x40000000, 1, null, 2, 0x80, null);
    if (@intFromPtr(handle) == std.math.maxInt(usize)) return error.OpenFailed;
    return handle;
}
fn write(handle: w.HANDLE, bytes: []const u8) !void {
    var offset: usize = 0;
    while (offset < bytes.len) {
        var written: u32 = 0;
        if (WriteFile(handle, bytes[offset..].ptr, @intCast(bytes.len - offset), &written, null) == .FALSE or written == 0) return error.WriteFailed;
        offset += written;
    }
}
fn note(comptime fmt: []const u8, args: anytype) void {
    var buf: [4096]u8 = undefined;
    const text = std.fmt.bufPrint(&buf, fmt ++ "\r\n", args) catch return;
    if (progress) |handle| {
        write(handle, text) catch {
            failed = true;
        };
        _ = FlushFileBuffers(handle);
    }
    log.info("{s}", .{text[0 .. text.len - 2]});
}
fn line(comptime fmt: []const u8, args: anytype) !void {
    var buf: [8192]u8 = undefined;
    const text = try std.fmt.bufPrint(&buf, fmt ++ "\r\n", args);
    try write(output orelse return error.NoOutput, text);
}
fn api(comptime T: type, index: usize) T {
    return @ptrFromInt(table[index]);
}
const F0 = *const fn () callconv(.c) usize;
const F1 = *const fn (usize) callconv(.c) usize;
const F2 = *const fn (usize, usize) callconv(.c) usize;
const Iter = *const fn (usize, *usize) callconv(.c) usize;
// Read only through RPM, including strings; never std.mem.span on a game pointer.
fn name(address: usize, buffer: []u8) ![]const u8 {
    if (address == 0) return error.NullName;
    var offset: usize = 0;
    while (offset < buffer.len) {
        // Do not cross page boundaries; a valid string can end at a page edge.
        const count = @min(@min(64, buffer.len - offset), 4096 - ((address + offset) & 4095));
        if (!peek(address + offset, buffer[offset .. offset + count])) return error.UnreadableName;
        for (buffer[offset .. offset + count], 0..) |ch, i| {
            if (ch == 0) return buffer[0 .. offset + i];
            if (ch < 32) return error.InvalidName;
        }
        offset += count;
    }
    return error.NameTooLong;
}
// type_get_name returns il2cpp-allocated storage; release with this build's free.
fn typeRecord(label: []const u8, index: usize, typ: usize) !void {
    if (typ == 0) return error.NullType;
    const ptr = api(F1, 159)(typ);
    if (ptr == 0) return error.NullTypeName;
    const release: *const fn (usize) callconv(.c) void = @ptrFromInt(table[13]);
    defer release(ptr);
    var buffer: [4096]u8 = undefined;
    const text = try name(ptr, &buffer);
    try line("{s}\t{d}\t{s}", .{ label, index, text });
}
/// Read and validate Unity's API table without writing the dump. Idempotent, so other modules
/// (eventlog.zig) can call it lazily on the game thread once Unity has populated the table.
pub fn validateTable() !void {
    if (table_valid) return;
    const g = GetModuleHandleA("GameAssembly.dll") orelse return error.NoGameAssembly;
    const unity = GetModuleHandleA("UnityPlayer.dll") orelse return error.NoUnityPlayer;
    game = @intFromPtr(g);
    var header: [4096]u8 = undefined;
    if (!peek(game, &header)) return error.UnreadableHeader;
    const pe = std.mem.readInt(u32, header[60..64], .little);
    if (pe > header.len - 0x90) return error.InvalidPE;
    game_size = std.mem.readInt(u32, header[pe + 0x50 ..][0..4], .little);
    if (game_size != 0x21714000) return error.UnsupportedClient;
    if (!peek(@intFromPtr(unity) + table_offset, std.mem.asBytes(&table))) return error.TableUnreadable;
    // Report every mismatch before failing closed, so a patched client yields the real table in
    // one run instead of one index per run. Entries pinned to 0 only have to land in the image.
    var mismatches: usize = 0;
    inline for (expected, 0..) |rva, i| {
        if (rva == 0) {
            if (table[i] < game or table[i] >= game + game_size) {
                note("API[{d}] unpinned entry outside GameAssembly: 0x{X}", .{ i, table[i] });
                mismatches += 1;
            } else note("API[{d}] unpinned; actual RVA 0x{X}", .{ i, table[i] - game });
        } else if (table[i] != game + rva) {
            note("API[{d}] expected RVA 0x{X}, actual 0x{X}", .{ i, rva, table[i] -% game });
            mismatches += 1;
        }
    }
    if (mismatches != 0) return error.TableMismatch;
    // Verify the known code bytes too, not just pointers into a module.
    // All seven re-read from the CNBetaWin3.3.4 binary at the RVAs the 2026-09-25 first-run
    // report pinned (the run reported 88 unpinned slots and corrected 20 wrong offline pins,
    // then failed closed with TableMismatch, by design). What changed from 3.3.3, and why:
    //   63, 115  unchanged -- position-independent, no operands that move.
    //   75       unchanged TOO this build: its field offset stayed [rcx+0x1c]. Still expect it
    //            to shift on other builds, as it did 3.3.2 -> 3.3.3.
    //   65       RIP-relative displacement; 152 a rel32 jmp. Both move whenever anything moves.
    //   73, 167  per-build obfuscation constants: 73's movabs key regenerated; 167 keeps the
    //            3.3.3 shape (mov eax,imm32; add eax,[rcx+disp]) with a new key and its field
    //            offset moved 0x2c -> 0x3c.
    const checks = .{
        .{ 63, "\x48\x83\xec\x28\x48\x8b\x05" },
        .{ 65, "\x48\x8b\x0d\x89\x54\xdb\x04" },
        .{ 73, "\x48\xb8\xbe\x70\x37\x76\x11\x6e\x5a\x5e" },
        .{ 75, "\x8b\x41\x1c\x25\xff\xff\xff\x00" },
        .{ 115, "\x48\x8b\x51\x38\x48\x85\xd2" },
        .{ 152, "\xe9\x6b\x76\x08\x00" },
        .{ 167, "\xb8\x7e\x66\x04\x94\x03\x41\x3c" },
    };
    inline for (checks) |check| {
        var bytes: [check[1].len]u8 = undefined;
        if (!peek(table[check[0]], &bytes) or !std.mem.eql(u8, &bytes, check[1])) return error.CodeMismatch;
    }
    note("Validated CNBetaWin3.3.4: GameAssembly=0x{X}; Unity table=0x{X}", .{ game, @intFromPtr(unity) + table_offset });
    table_valid = true;
}
fn loadTable() !void {
    try validateTable();
    try line("# thaumiel dumper v7; GameAssembly base=0x{X}; no export call", .{game});
    for (table, 0..) |ptr, i| try line("API\t{d}\t0x{X}", .{ i, ptr - game });
}
/// `class_get_name` (verified index 37) of an Il2CppClass, copied through RPM into `buffer`.
/// Only valid after validateTable() succeeded.
pub fn className(klass: usize, buffer: []u8) ![]const u8 {
    if (!table_valid) return error.TableNotValidated;
    if (klass == 0) return error.NullClass;
    return name(api(F1, 37)(klass), buffer);
}
// Lookup sessions are for a caller-owned, initially unattached worker thread.
// Keep attachment local to that thread; never borrow the dump's global `attached`.
threadlocal var lookup_attached: usize = 0;

pub fn beginLookup() !void {
    if (!table_valid) return error.TableNotValidated;
    if (lookup_attached != 0) return error.LookupAlreadyAttached;
    const domain = api(F0, 63)();
    if (domain == 0) return error.NoDomain;
    lookup_attached = api(F1, 152)(domain);
    if (lookup_attached == 0) return error.AttachFailed;
}

pub fn endLookup() void {
    if (lookup_attached == 0) return;
    const release: *const fn (usize) callconv(.c) void = @ptrFromInt(table[153]);
    release(lookup_attached);
    lookup_attached = 0;
}

fn requireLookup() !void {
    if (!table_valid) return error.TableNotValidated;
    if (lookup_attached == 0) return error.LookupNotAttached;
}

/// Exact namespace/name across all images; beginLookup/endLookup must bracket calls.
pub fn findClass(namespace: []const u8, class_name: []const u8) !usize {
    try requireLookup();
    const domain = api(F0, 63)();
    if (domain == 0) return error.NoDomain;
    var count: usize = 0;
    const assemblies = api(Iter, 65)(domain, &count);
    if (assemblies == 0 or count == 0 or count > 4096) return error.InvalidAssemblies;
    var found: ?usize = null;
    for (0..count) |a| {
        const assembly = try word(assemblies + a * @sizeOf(usize));
        if (assembly == 0) return error.NullAssembly;
        const img = api(F1, 22)(assembly);
        if (img == 0) return error.NullImage;
        const count_classes = api(F1, 167)(img);
        if (count_classes > 1000000) return error.InvalidClassCount;
        for (0..count_classes) |i| {
            const klass = api(F2, 168)(img, i);
            if (klass == 0) return error.NullClass;
            var cn: [2048]u8 = undefined;
            var ns: [2048]u8 = undefined;
            if (!std.mem.eql(u8, try name(api(F1, 37)(klass), &cn), class_name)) continue;
            if (!std.mem.eql(u8, try name(api(F1, 39)(klass), &ns), namespace)) continue;
            if (found != null) return error.AmbiguousClass;
            found = klass;
        }
    }
    return found orelse error.ClassNotFound;
}

/// Returns the absolute native pointer at MethodInfo+0, never a guessed RVA.
pub fn findMethod(klass: usize, method_name: []const u8, param_count: usize) !usize {
    try requireLookup();
    if (klass == 0) return error.NullClass;
    var found: ?usize = null;
    var iter: usize = 0;
    var n: usize = 0;
    while (true) {
        const method = api(Iter, 35)(klass, &iter);
        if (method == 0) break;
        n += 1;
        if (n > 65536) return error.MethodIterationLimit;
        var buffer: [2048]u8 = undefined;
        if (!std.mem.eql(u8, try name(api(F1, 115)(method), &buffer), method_name)) continue;
        if (api(F1, 121)(method) != param_count) continue;
        if (found != null) return error.AmbiguousMethod;
        found = method;
    }
    const native = try word(found orelse return error.MethodNotFound);
    if (native < game or native - game >= game_size or native == 0) return error.NativeOutsideGameAssembly;
    return native;
}

/// Search the full parent chain; a hidden/duplicate name is ambiguous, not first-wins.
pub fn findField(klass: usize, field_name: []const u8) !usize {
    try requireLookup();
    if (klass == 0) return error.NullClass;
    var found: ?usize = null;
    var current = klass;
    var depth: usize = 0;
    while (current != 0) : (current = api(F1, 40)(current)) {
        depth += 1;
        if (depth > 256) return error.ParentIterationLimit;
        var iter: usize = 0;
        var n: usize = 0;
        while (true) {
            const field = api(Iter, 31)(current, &iter);
            if (field == 0) break;
            n += 1;
            if (n > 65536) return error.FieldIterationLimit;
            var buffer: [2048]u8 = undefined;
            if (!std.mem.eql(u8, try name(api(F1, 73)(field), &buffer), field_name)) continue;
            if (found != null) return error.AmbiguousField;
            found = api(F1, 75)(field);
        }
    }
    return found orelse error.FieldNotFound;
}

fn dumpRuntime() !void {
    stage = "domain_get";
    note("Stage: {s}", .{stage});
    const domain = api(F0, 63)();
    if (domain == 0) return error.NoDomain;
    stage = "thread_attach";
    note("Stage: {s}", .{stage});
    attached = api(F1, 152)(domain);
    if (attached == 0) return error.AttachFailed;
    stage = "domain_get_assemblies";
    note("Stage: {s}", .{stage});
    var count: usize = 0;
    const assemblies = api(Iter, 65)(domain, &count);
    if (assemblies == 0 or count == 0 or count > 4096) return error.InvalidAssemblies;
    note("Enumerating {d} assemblies", .{count});
    var classes: usize = 0;
    var fields: usize = 0;
    var methods: usize = 0;
    for (0..count) |a| {
        stage = "assembly_get_image";
        const assembly = try word(assemblies + a * 8);
        if (assembly == 0) return error.NullAssembly;
        const img = api(F1, 22)(assembly);
        if (img == 0) return error.NullImage;
        stage = "image_get_class_count";
        const class_count = api(F1, 167)(img);
        if (class_count > 1000000) return error.InvalidClassCount;
        note("Assembly {d}/{d}: {d} classes", .{ a + 1, count, class_count });
        try line("ASSEMBLY\t{d}\t0x{X}\t{d}", .{ a, img, class_count });
        for (0..class_count) |i| {
            stage = "image_get_class";
            const cls = api(F2, 168)(img, i);
            if (cls == 0) return error.NullClass;
            var cn: [2048]u8 = undefined;
            var ns: [2048]u8 = undefined;
            stage = "class_get_name";
            const class_name = try name(api(F1, 37)(cls), &cn);
            stage = "class_get_namespace";
            const namespace = try name(api(F1, 39)(cls), &ns);
            try line("CLASS\t{d}\t{d}\t{s}\t{s}\t0x{X}", .{ a, i, namespace, class_name, cls });
            stage = "class_get_parent";
            const parent = api(F1, 40)(cls);
            if (parent != 0) {
                stage = "parent_type_name";
                try typeRecord("PARENT", 0, api(F1, 51)(parent));
            }
            // Persist the class before making any lazy metadata-enumeration call.
            _ = FlushFileBuffers(output.?);
            if (i % 1000 == 0) note("Class {d}/{d}: {s}.{s}", .{ i, class_count, namespace, class_name });
            var iter: usize = 0;
            var n: usize = 0;
            while (true) {
                stage = "class_get_fields";
                const field = api(Iter, 31)(cls, &iter);
                if (field == 0) break;
                n += 1;
                if (n > 65536) return error.FieldIterationLimit;
                var fn_buf: [2048]u8 = undefined;
                stage = "field_get_name";
                const field_name = try name(api(F1, 73)(field), &fn_buf);
                stage = "field_get_offset";
                const offset = api(F1, 75)(field);
                try line("FIELD\t{s}\t0x{X}", .{ field_name, offset });
                stage = "field_type_name";
                try typeRecord("FIELD_TYPE", n - 1, api(F1, 76)(field));
                fields += 1;
            }
            iter = 0;
            n = 0;
            while (true) {
                stage = "class_get_methods";
                const method = api(Iter, 35)(cls, &iter);
                if (method == 0) break;
                n += 1;
                if (n > 65536) return error.MethodIterationLimit;
                var mn: [2048]u8 = undefined;
                stage = "method_get_name";
                const method_name = try name(api(F1, 115)(method), &mn);
                stage = "method_pointer_read";
                // runtime_invoke (3.3.2: RVA 0x90A440; 3.3.0: 0x8FCCA0) loads [MethodInfo+0] into
                // RCX and calls the invoker at +0x18 (3.3.0: +0x10). No generated method is called here.
                const native = try word(method);
                const params = api(F1, 121)(method);
                if (native >= game and native < game + game_size) {
                    try line("METHOD\t{s}\t{d}\tRVA\t0x{X}", .{ method_name, params, native - game });
                } else {
                    try line("METHOD\t{s}\t{d}\tUNRESOLVED_NATIVE\t0x{X}", .{ method_name, params, native });
                }
                var flags: [2]u8 = undefined;
                // MethodInfo.flags: runtime_invoke tests `[rdi+0x2e], 0x10` in 3.3.4 (3.3.3:
                // +0x2c; 3.3.2: +0x30; 3.3.0: +0x2c -- it moves nearly every build). Re-derive it
                // per build by disassembling runtime_invoke, API slot 138 (3.3.4: RVA 0x927B30,
                // found 2026-09-25 by masked prefix match, unique hit; 3.3.3: 0x9140E0): the
                // function is identical up to that `test byte ptr [rdi+disp], 0x10` with only
                // relocation operands masked. A WRONG value here is silent -- every METHOD_FLAGS
                // row reads 0x0 rather than failing, which is how the 3.3.2 pin survived
                // unnoticed into the first 3.3.3 dump.
                if (!peek(method + 0x2e, &flags)) return error.UnreadableMethodFlags;
                try line("METHOD_FLAGS\t0x{X}", .{std.mem.readInt(u16, &flags, .little)});
                stage = "method_return_type";
                try typeRecord("RETURN_TYPE", 0, api(F1, 114)(method));
                for (0..params) |param_index| {
                    stage = "method_param_type";
                    try typeRecord("PARAM_TYPE", param_index, api(F2, 122)(method, param_index));
                }
                methods += 1;
            }
            classes += 1;
        }
    }
    try line("COMPLETE\tclasses={d}\tfields={d}\tmethods={d}", .{ classes, fields, methods });
    note("COMPLETE: {d} classes, {d} fields, {d} methods. Saved il2cpp-v7.tsv", .{ classes, fields, methods });
}
fn guardedDump() callconv(.c) void {
    dumpRuntime() catch |err| {
        failed = true;
        note("STOPPED at {s}: {t}; output is partial", .{ stage, err });
    };
}
fn detach() callconv(.c) void {
    const f: *const fn (usize) callconv(.c) void = @ptrFromInt(table[153]);
    f(attached);
}
const readiness = @import("runtime_readiness.zig");
var readiness_validated = false;
const Readiness = enum { waiting, ready, failed };
fn runtimeReady() Readiness {
    if (!table_valid) {
        // validateTable() logs every slot on a miss, so only call it once the table is populated:
        // Unity fills all 194 entries together when it binds GameAssembly, before il2cpp_init.
        const g = GetModuleHandleA("GameAssembly.dll") orelse return .waiting;
        const unity = GetModuleHandleA("UnityPlayer.dll") orelse return .waiting;
        const first = word(@intFromPtr(unity) + table_offset + 63 * @sizeOf(usize)) catch return .waiting;
        if (first != @intFromPtr(g) + expected[63]) return .waiting;
        validateTable() catch |err| {
            log.err("hitlog and dump stopped before runtime calls: {t}", .{err});
            return .failed;
        };
    }
    if (!readiness_validated) {
        readiness.validate(peek, game) catch |err| {
            log.err("hitlog and dump stopped before readiness reads: {t}", .{err});
            return .failed;
        };
        readiness_validated = true;
    }
    return if (readiness.ready(peek, game)) .ready else .waiting;
}
/// Ceiling on the readiness poll; a fight cannot start before il2cpp is up, so this only bounds
/// a client that never initializes (wrong build, launcher failure).
const ready_timeout_ms: u64 = 180_000;
fn threadMain(_: ?*anyopaque) callconv(.winapi) u32 {
    // Hitlog needs initialized metadata even when the optional dump is disabled. Poll for it
    // using only guarded memory reads of the main thread context published by Runtime::Init.
    // No fixed startup delay and no speculative calls through the API table.
    const t0 = GetTickCount64();
    log.info("worker started; waiting for runtime readiness", .{});
    var next_report: u64 = 0;
    while (true) {
        switch (runtimeReady()) {
            .ready => break,
            .failed => return 1,
            .waiting => {},
        }
        const elapsed = GetTickCount64() - t0;
        if (elapsed >= next_report) {
            const state = if (game != 0) readiness.snapshot(peek, game) else readiness.Snapshot{};
            log.info("readiness waiting: table={any} anchors={any} game=0x{X} state={any}", .{
                table_valid, readiness_validated, game, state,
            });
            next_report = elapsed + 5000;
        }
        if (GetTickCount64() - t0 > ready_timeout_ms) {
            log.err("il2cpp runtime not ready after {d} ms; hitlog not installed, dump skipped", .{ready_timeout_ms});
            return 1;
        }
        Sleep(50);
    }
    log.info("il2cpp runtime ready {d} ms after thaumiel start; resolving hitlog", .{GetTickCount64() - t0});
    @import("hitlog.zig").installFromWorker();
    @import("capture.zig").installFromWorker();
    @import("timescalelog.zig").installFromWorker();
    @import("statelog.zig").installFromWorker();
    // The ~50 MB dump is only for re-finding pins after a client update, so since 2026-09-28 it
    // is opt-in: dumper-enable.txt beside the launcher. The lookups above run either way.
    if (GetFileAttributesA("dumper-enable.txt") == 0xffffffff) {
        log.info("v7 dump skipped (create dumper-enable.txt beside the launcher to write it)", .{});
        return 0;
    }
    var path: capture.PathBuf = undefined;
    progress = openFile(capture.sessionPath(&path, "il2cpp-v7.log")) catch {
        log.err("Cannot create il2cpp-v7.log; dumper stopped", .{});
        return 1;
    };
    defer {
        _ = CloseHandle(progress.?);
        progress = null;
    }
    note("dumper v7: existing-table enumeration; hitlog resolution completed", .{});
    output = openFile(capture.sessionPath(&path, "il2cpp-v7.tsv")) catch {
        note("Cannot create il2cpp-v7.tsv", .{});
        return 1;
    };
    defer {
        _ = FlushFileBuffers(output.?);
        _ = CloseHandle(output.?);
        output = null;
    }
    loadTable() catch |err| {
        note("Stopped before any runtime calls: {t}", .{err});
        return 1;
    };
    var code: u32 = 0;
    var address: usize = 0;
    if (dumper_guard(guardedDump, &code, &address) == 0) {
        failed = true;
        note("STOPPED: native exception 0x{X} at 0x{X}; stage={s}; output is partial", .{ code, address, stage });
    }
    if (attached != 0) {
        stage = "thread_detach";
        if (dumper_guard(detach, &code, &address) == 0) {
            note("Thread detach exception 0x{X} at 0x{X}", .{ code, address });
            return 1;
        }
    }
    return if (failed) 1 else 0;
}
pub fn start() void {
    const handle = CreateThread(null, 0, threadMain, null, 0, null) orelse {
        log.err("Cannot start v7 dumper thread", .{});
        return;
    };
    _ = CloseHandle(handle);
}
