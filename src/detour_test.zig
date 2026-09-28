//! Native tests for detour.zig: the shared prologue relocator both statelog.zig and future
//! hooks install through. Each test builds a REAL function in RWX memory, patches it, and
//! calls it, so relocation, the `cmp [rip+disp]` re-encoding and the call-through are all
//! exercised rather than asserted about.
//!
//!   zig test src/detour_test.zig
//!
//! No game and no il2cpp: the "targets" are hand-assembled x86-64 that mirror the two prologue
//! shapes found in the client (see detour.zig's module comment).

const std = @import("std");
const w = std.os.windows;
const nt = @import("nt.zig");
const detour = @import("detour.zig");

extern "kernel32" fn VirtualAlloc(?*anyopaque, usize, u32, u32) callconv(.winapi) ?*anyopaque;
const MEM_COMMIT_RESERVE: u32 = 0x1000 | 0x2000;
const PAGE_EXECUTE_READWRITE: u32 = 0x40;
const PAGE_READWRITE: u32 = 0x04;

fn alloc(len: usize, protect: u32) [*]u8 {
    return @ptrCast(VirtualAlloc(null, len, MEM_COMMIT_RESERVE, protect).?);
}

/// push rsi; push rdi; push rbx; sub rsp,0x20; mov rsi,rcx  -- the 10 position-independent
/// bytes of `BALGGDCFODF::JELANNGODEG`, which statelog hooks with the .cmp_rip shape.
const plain10 = [_]u8{ 0x56, 0x57, 0x53, 0x48, 0x83, 0xEC, 0x20, 0x48, 0x89, 0xCE };

/// The same, padded to the 12 bytes `Interception.replace` overwrites, which is the minimum a
/// .plain hook can relocate (the real targets reach 12 with more pushes or a wider `sub rsp`).
const plain12 = plain10 ++ [_]u8{ 0x66, 0x90 }; // xchg ax,ax

/// mov eax, imm32
fn appendMov(bytes: [*]u8, at: usize, value: u32) usize {
    bytes[at] = 0xB8;
    std.mem.writeInt(u32, bytes[at + 1 ..][0..4], value, .little);
    return at + 5;
}

/// Undo `plain10`'s prologue and return whatever is in eax.
fn appendEpilogue(bytes: [*]u8, at: usize) usize {
    bytes[at] = 0x48; // add rsp, 0x20
    bytes[at + 1] = 0x83;
    bytes[at + 2] = 0xC4;
    bytes[at + 3] = 0x20;
    bytes[at + 4] = 0x5B; // pop rbx
    bytes[at + 5] = 0x5F; // pop rdi
    bytes[at + 6] = 0x5E; // pop rsi
    bytes[at + 7] = 0xC3; // ret
    return at + 8;
}

/// A function whose first 12 bytes are `plain12`, returning `value`.
fn buildPlain(value: u32) usize {
    const code = alloc(64, PAGE_EXECUTE_READWRITE);
    @memcpy(code[0..plain12.len], &plain12);
    _ = appendEpilogue(code, appendMov(code, plain12.len, value));
    return @intFromPtr(code);
}

/// `plain10`, then `cmp byte ptr [rip+disp32], 0` pointing at `flag`, then the tail. Mirrors
/// the il2cpp class-initialised check the .cmp_rip shape relocates.
fn buildCmpRip(value: u32, flag: *u8) usize {
    const code = alloc(64, PAGE_EXECUTE_READWRITE);
    @memcpy(code[0..plain10.len], &plain10);
    var i = plain10.len;
    code[i] = 0x80;
    code[i + 1] = 0x3D;
    const after: i64 = @intCast(@intFromPtr(code) + i + 7);
    std.mem.writeInt(i32, code[i + 2 ..][0..4], @intCast(@as(i64, @intCast(@intFromPtr(flag))) - after), .little);
    code[i + 6] = 0x00;
    i += 7;
    // flag == 0 -> je taken -> `value`; flag != 0 -> fall through -> 0xBAD. The two paths must
    // not share a later `mov eax`, or the test could not tell which way the flags went.
    code[i] = 0x74; // je +7, over the BAD mov and its jmp
    code[i + 1] = 0x07;
    i += 2;
    i = appendMov(code, i, 0xBAD);
    code[i] = 0xEB; // jmp +5, over the value mov
    code[i + 1] = 0x05;
    i += 2;
    i = appendMov(code, i, value);
    _ = appendEpilogue(code, i);
    return @intFromPtr(code);
}

const Fn = *const fn () callconv(.c) u32;

// --- .plain: the relocated prologue runs in the stub, the original's body still returns 7 ---

var plain_original: u64 = 0;
var plain_calls: u32 = 0;

fn plainReplacement() callconv(.c) u32 {
    plain_calls += 1;
    const original: Fn = @ptrFromInt(@as(usize, @intCast(plain_original)));
    return original() + 100;
}

test "plain prologue: patched target calls through the stub" {
    const target = buildPlain(7);
    const direct: Fn = @ptrFromInt(target);
    try std.testing.expectEqual(@as(u32, 7), direct());

    var syscall: nt.Syscall = .init;
    const stub = try detour.install(&syscall, target, .{ .prologue = &plain12, .shape = .plain }, &plain_original, plainReplacement);
    try std.testing.expect(stub != 0);
    try std.testing.expectEqual(stub, @as(usize, @intCast(plain_original)));

    // The same address now runs the replacement, which still reaches the original body.
    try std.testing.expectEqual(@as(u32, 107), direct());
    try std.testing.expectEqual(@as(u32, 1), plain_calls);

    // The stub begins with the relocated bytes and ends in an absolute jmp past them.
    const bytes: [*]const u8 = @ptrFromInt(stub);
    try std.testing.expectEqualSlices(u8, &plain12, bytes[0..plain12.len]);
    try std.testing.expectEqual(@as(u8, 0xFF), bytes[plain12.len]);
    try std.testing.expectEqual(@as(u8, 0x25), bytes[plain12.len + 1]);
    try std.testing.expectEqual(
        @as(u64, target + plain12.len),
        std.mem.readInt(u64, bytes[plain12.len + 6 ..][0..8], .little),
    );
}

// --- .cmp_rip: the re-encoded compare must set the same flags on both paths ---

var cmp_original: u64 = 0;

fn cmpReplacement() callconv(.c) u32 {
    const original: Fn = @ptrFromInt(@as(usize, @intCast(cmp_original)));
    return original();
}

test "cmp_rip prologue: the relocated compare reads the same flag" {
    const flag: *u8 = @ptrCast(alloc(1, PAGE_READWRITE));
    flag.* = 0; // zero -> the `je` is taken -> the body's own value
    const target = buildCmpRip(42, flag);
    const direct: Fn = @ptrFromInt(target);
    try std.testing.expectEqual(@as(u32, 42), direct());

    var syscall: nt.Syscall = .init;
    const stub = try detour.install(&syscall, target, .{ .prologue = &plain10, .shape = .cmp_rip }, &cmp_original, cmpReplacement);
    try std.testing.expectEqual(@as(u32, 42), direct());

    // Flip the flag: the relocated compare must now fall through to the 0xBAD path, proving it
    // reads the real byte and not a stale copy.
    flag.* = 1;
    try std.testing.expectEqual(@as(u32, 0xBAD), direct());

    // mov rax, imm64 with the flag's absolute address, then `cmp byte ptr [rax], 0`.
    const bytes: [*]const u8 = @ptrFromInt(stub);
    try std.testing.expectEqual(@as(u8, 0x48), bytes[plain10.len]);
    try std.testing.expectEqual(@as(u8, 0xB8), bytes[plain10.len + 1]);
    try std.testing.expectEqual(
        @intFromPtr(flag),
        @as(usize, @intCast(std.mem.readInt(u64, bytes[plain10.len + 2 ..][0..8], .little))),
    );
    try std.testing.expectEqual(@as(u8, 0x80), bytes[plain10.len + 10]);
    try std.testing.expectEqual(@as(u8, 0x38), bytes[plain10.len + 11]);
    try std.testing.expectEqual(
        @as(u64, target + plain10.len + 7),
        std.mem.readInt(u64, bytes[plain10.len + 19 ..][0..8], .little),
    );
}

// --- refusals: a client whose bytes moved must be left untouched ---

var unused_slot: u64 = 0;

fn neverCalled() callconv(.c) u32 {
    return 0;
}

test "a prologue mismatch installs nothing" {
    const target = buildPlain(5);
    var wrong = plain12;
    wrong[0] = 0x90; // the client patched; the first byte is no longer `push rsi`
    try std.testing.expect(!detour.matches(target, .{ .prologue = &wrong, .shape = .plain }));

    var syscall: nt.Syscall = .init;
    try std.testing.expectError(
        error.PrologueMismatch,
        detour.install(&syscall, target, .{ .prologue = &wrong, .shape = .plain }, &unused_slot, neverCalled),
    );
    // Untouched: still the original bytes, still returns 5, and no stub was published.
    const direct: Fn = @ptrFromInt(target);
    try std.testing.expectEqual(@as(u32, 5), direct());
    try std.testing.expectEqual(@as(u64, 0), unused_slot);
}

test "a prologue shorter than the patch is refused" {
    const target = buildPlain(5);
    var syscall: nt.Syscall = .init;
    try std.testing.expectError(
        error.PrologueTooShort,
        detour.install(&syscall, target, .{ .prologue = plain12[0..8], .shape = .plain }, &unused_slot, neverCalled),
    );
    const direct: Fn = @ptrFromInt(target);
    try std.testing.expectEqual(@as(u32, 5), direct());
}

test "cmp_rip requires the compare's exact encoding" {
    const flag: *u8 = @ptrCast(alloc(1, PAGE_READWRITE));
    flag.* = 0;
    const target = buildCmpRip(1, flag);
    // The same bytes are not a .cmp_rip match one byte further along.
    try std.testing.expect(!detour.matches(target, .{ .prologue = plain10[0..9], .shape = .cmp_rip }));
    try std.testing.expect(detour.matches(target, .{ .prologue = &plain10, .shape = .cmp_rip }));
}
