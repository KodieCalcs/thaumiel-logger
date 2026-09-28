# Thaumiel dumper v6 (CNBetaWin3.3.0 only)

Launch the existing remielle.exe normally. After 25 seconds, the dumper writes
il2cpp-v6.log and il2cpp-v6.tsv beside the launcher. Wait for COMPLETE in the log.
The TSV groups FIELD and METHOD rows under their preceding CLASS row. Method
addresses marked RVA are relative to GameAssembly.dll. UNRESOLVED_NATIVE entries
must not be treated as callable addresses. This is a metadata listing, not yet
the per-hit combat logger.

The crashing il2cpp_get_api_table call has been removed. The dumper reads Unity's
existing table at UnityPlayer.dll+0x1F96648, checks all 194 entries against the
2026-09-11 dump, checks selected code signatures, and attaches its worker to the
runtime before enumeration. Other client versions fail closed before API calls.

If it stops, keep both output files and report back. They are readable over the
laptop's share; no screenshot is necessary. A native exception handler catches
selected synchronous faults in the dumper and records the stage and address.
This does not guarantee recovery from arbitrary runtime faults or deadlocks.

To disable dumping, create an empty dumper-disable.txt beside remielle.exe.
Outputs are overwritten on each launch; preserve them before another run.

Verified this build's API indices: assembly_get_image=22, class_get_fields=31,
class_get_methods=35, class_get_name=37, class_get_namespace=39, domain_get=63,
domain_get_assemblies=65, field_get_name=73, field_get_offset=75,
method_get_name=115, method_get_param_count=121, thread_attach=152,
thread_detach=153, image_get_class_count=167, image_get_class=168.
Do not copy indices from other clients. In particular, index 116 returns the
invoker pointer at MethodInfo+0x10, not a name. Native method pointer +0 is
verified by the runtime_invoke implementation at RVA 0x8FCCA0.

Build uses official Zig 0.16.0, ReleaseFast, with unwind tables for the SEH bridge.
The SEH bridge passed a standalone real read-only-memory write-fault test.
Live client enumeration still needs the user's launch to validate it.

Unrelated calculator checks: typecheck passed; Vitest had 1295 passing and four
failing tests (three Remielle Luminize, one Rina integration) in the existing
modified calculator tree. No calculator source was changed for this build.
