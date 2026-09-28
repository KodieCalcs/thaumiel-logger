// Modified from upstream thaumiel (0e669bc) for the per-hit logger fork, 2026-09-11..13: unwind
// tables, the C/asm probe sources and libc are added to the DLL; 2026-09-28: the releases-url
// option, the version-gate test step and a baseline x86_64 default target. See README.md
// (AGPL-3.0 §5a).
const std = @import("std");

pub fn build(b: *std.Build) void {
    // x86_64 named explicitly so the default CPU is the generic baseline, not the build machine's
    // own: the DLL runs on players' machines, and a "native" build can use instructions (AVX-512,
    // AVX-VNNI, ...) their CPUs lack. `-Dcpu=native` still opts in for a local-only build.
    const target = b.standardTargetOptions(.{ .default_target = .{ .cpu_arch = .x86_64, .os_tag = .windows } });
    const optimize = b.standardOptimizeOption(.{});

    const launcher = b.addExecutable(.{
        .name = "remielle",
        .win32_manifest = b.addWriteFiles().add(
            "launcher.manifest",
            @embedFile("win32_manifest.xml"),
        ),
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/launcher.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    b.installArtifact(launcher);

    const dynlib = b.addLibrary(.{
        .name = "thaumiel",
        .linkage = .dynamic,
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/dynlib.zig"),
            .target = target,
            .optimize = optimize,
            .unwind_tables = .sync,
        }),
    });
    b.installArtifact(dynlib);
    dynlib.root_module.addCSourceFile(.{
        .file = b.path("src/dumper_guard.c"),
        .flags = &.{"-fms-extensions"},
    });
    dynlib.root_module.addCSourceFile(.{
        .file = b.path("src/hit_hook.c"),
        .flags = &.{"-fms-extensions"},
    });
    dynlib.root_module.addCSourceFile(.{
        .file = b.path("src/event_hook.c"),
        .flags = &.{"-fms-extensions"},
    });
    dynlib.root_module.addCSourceFile(.{
        .file = b.path("src/battle_hook.c"),
        .flags = &.{"-fms-extensions"},
    });
    dynlib.root_module.addCSourceFile(.{
        .file = b.path("src/timescale_hook.c"),
        .flags = &.{"-fms-extensions"},
    });
    dynlib.root_module.addCSourceFile(.{
        .file = b.path("src/state_hook.c"),
        .flags = &.{"-fms-extensions"},
    });
    dynlib.root_module.link_libc = true;
    dynlib.root_module.addCSourceFile(.{ .file = b.path("src/damage_probe.c"), .flags = &.{} });
    dynlib.root_module.addAssemblyFile(b.path("src/damage_probe.S"));

    // Where logger-status.txt tells players to get an updated build; CI passes the repo's own
    // Releases page (.github/workflows/release.yml).
    const options = b.addOptions();
    options.addOption([]const u8, "releases_url", b.option(
        []const u8,
        "releases-url",
        "URL of the download page named in logger-status.txt",
    ) orelse "the Releases page of the repository you downloaded this from");
    dynlib.root_module.addOptions("build_options", options);

    // `zig build test`: the logger version gate and folder names (no game needed).
    const gate_tests = b.addTest(.{ .root_module = b.createModule(.{
        .root_source_file = b.path("src/logger_client.zig"),
        .target = target,
        .optimize = optimize,
    }) });
    gate_tests.root_module.addOptions("build_options", options);
    const naming_tests = b.addTest(.{ .root_module = b.createModule(.{
        .root_source_file = b.path("src/capture_names.zig"),
        .target = target,
        .optimize = optimize,
    }) });
    const test_step = b.step("test", "Run the logger's no-game tests (version gate, folder names)");
    test_step.dependOn(&b.addRunArtifact(gate_tests).step);
    test_step.dependOn(&b.addRunArtifact(naming_tests).step);

    const assets_dir = b.build_root.handle.openDir(b.graph.io, "assets", .{ .iterate = true }) catch |err| {
        std.debug.panic("unable to open assets directory: {t}", .{err});
    };
    defer assets_dir.close(b.graph.io);

    var it = assets_dir.iterateAssumeFirstIteration();
    while (it.next(b.graph.io) catch @panic("failed to read dir")) |entry| {
        if (std.mem.startsWith(u8, entry.name, ".") or entry.kind != .file)
            continue;

        dynlib.root_module.addAnonymousImport(
            entry.name,
            .{ .root_source_file = b.path(b.fmt("assets/{s}", .{entry.name})) },
        );
    }
}
