//! A buffered TSV file in the current battle folder (capture.zig), with the open / rotate /
//! flush lifecycle every per-battle log shares. Rows are formatted into a fixed buffer and
//! written in 16 KiB chunks; `flushAll` at battle destroy makes the file complete on disk.
//! A slim SRW lock serialises writers -- the hooks run on the game thread, but nothing here
//! assumes it.

const std = @import("std");
const w = std.os.windows;
const capture = @import("capture.zig");

extern "kernel32" fn CreateFileA([*:0]const u8, u32, u32, ?*anyopaque, u32, u32, ?w.HANDLE) callconv(.winapi) w.HANDLE;
extern "kernel32" fn WriteFile(w.HANDLE, [*]const u8, u32, *u32, ?*anyopaque) callconv(.winapi) w.BOOL;
extern "kernel32" fn FlushFileBuffers(w.HANDLE) callconv(.winapi) w.BOOL;
extern "kernel32" fn CloseHandle(w.HANDLE) callconv(.winapi) w.BOOL;
extern "kernel32" fn AcquireSRWLockExclusive(*usize) callconv(.winapi) void;
extern "kernel32" fn ReleaseSRWLockExclusive(*usize) callconv(.winapi) void;

pub const LogFile = struct {
    name: []const u8,
    header: []const u8,
    out: ?w.HANDLE = null,
    buf: [16 << 10]u8 = undefined,
    len: usize = 0,
    lock: usize = 0,
    rows: u64 = 0,

    pub fn open(self: *LogFile) bool {
        var path: capture.PathBuf = undefined;
        const h = CreateFileA(capture.battlePath(&path, self.name), 0x40000000, 1, null, 2, 0x80, null);
        if (h == w.INVALID_HANDLE_VALUE) {
            self.out = null;
            return false;
        }
        self.out = h;
        self.rows = 0;
        self.emit("{s}", .{self.header});
        self.flush();
        return true;
    }

    fn flushLocked(self: *LogFile) void {
        if (self.len == 0) return;
        if (self.out) |h| {
            var written: u32 = 0;
            _ = WriteFile(h, &self.buf, @intCast(self.len), &written, null);
        }
        self.len = 0;
    }

    pub fn flush(self: *LogFile) void {
        AcquireSRWLockExclusive(&self.lock);
        defer ReleaseSRWLockExclusive(&self.lock);
        self.flushLocked();
    }

    /// Append one formatted row (the caller includes the trailing newline).
    pub fn emit(self: *LogFile, comptime fmt: []const u8, args: anytype) void {
        if (self.out == null) return;
        AcquireSRWLockExclusive(&self.lock);
        defer ReleaseSRWLockExclusive(&self.lock);
        if (self.len + 1024 > self.buf.len) self.flushLocked();
        const s = std.fmt.bufPrint(self.buf[self.len..], fmt, args) catch return;
        self.len += s.len;
        self.rows += 1;
    }

    /// Everything buffered so far reaches the disk.
    pub fn flushAll(self: *LogFile) void {
        self.flush();
        if (self.out) |h| _ = FlushFileBuffers(h);
    }

    /// Battle awake: finish the current file and open the next battle folder's.
    pub fn rotate(self: *LogFile) void {
        self.flushAll();
        if (self.out) |h| _ = CloseHandle(h);
        self.out = null;
        _ = self.open();
    }
};
