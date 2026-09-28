// Find the functions that consume ConfigEntityAttackProperty, by looking for
// x86 disp32 field accesses at its known offsets rather than by name (the
// runtime combat classes are all obfuscated).
//
// A `mov al,[rcx+0x174]` encodes the displacement as the literal bytes
// 74 01 00 00, whatever the register. So scanning for those 4-byte values and
// clustering hits per function finds code that reads several fields of the
// same struct -- which is what a damage routine does and what unrelated code
// does not.
//
//   node claude-attackprop-xref.cjs
const fs = require("fs");
const path = require("path");

const root = __dirname;
const DLL = path.join(root, "GameAssembly.dll");
const TSV = path.join(root, "il2cpp-v6.tsv");

// Offsets from `CLASS MoleMole.Config.ConfigEntityAttackProperty`.
// Restricted to >= 0x140 so the displacements are distinctive enough to be
// worth counting (small ones like 0x20 appear everywhere).
const FIELDS = [
  [0x140, "DamageElement"],
  [0x144, "DamageHitType"],
  [0x148, "HitType"],
  [0x14c, "IsUseBackupFrameHalt"],
  [0x150, "AnimDirectionType"],
  [0x154, "AtkSourceType"],
  [0x158, "IsCauseExhausted"],
  [0x15c, "OverrideDamageElementByAttackerElement"],
  [0x160, "AttackPropConfigEnum"],
  [0x164, "DamageTextWaitTime"],
  [0x168, "DamageTextID"],
  [0x16c, "SpecialDamageTextType"],
  [0x170, "IsIndirectTriggerCounter"],
  [0x171, "IsSharpDamage"],
  [0x172, "IsSkipDefAttack"],
  [0x174, "IsCauseStun"],
  [0x176, "UseDistanceAttenuation"],
  [0x177, "BanDamage"],
  [0x182, "IsHeavyAttack"],
];

// --- method table: RVA -> owning method --------------------------------------
console.log("loading method table...");
const methods = [];
{
  let cls = "";
  for (const row of fs.readFileSync(TSV, "utf8").split(/\r?\n/)) {
    if (row.startsWith("CLASS\t")) {
      const p = row.split("\t");
      cls = p[3] ? `${p[3]}.${p[4]}` : p[4];
    } else if (row.startsWith("METHOD\t")) {
      const p = row.split("\t");
      if (p[3] === "RVA") {
        const rva = parseInt(p[4], 16);
        if (rva) methods.push({ rva, cls, name: p[1], args: p[2] });
      }
    }
  }
}
methods.sort((a, b) => a.rva - b.rva);
const starts = methods.map((m) => m.rva);
console.log(`  ${methods.length} methods`);

function nearestMethod(rva) {
  let lo = 0;
  let hi = starts.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= rva) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best >= 0 ? methods[best] : null;
}

// Real function boundaries come from the x64 exception directory (.pdata), not
// from guessing at gaps between method RVAs -- that was attributing whole
// unmapped regions to whichever method happened to precede them.
let pdata = [];
function loadPdata(buf, sections) {
  const s = sections.find((x) => x.name === ".pdata");
  if (!s) return;
  const n = Math.floor(s.rawSize / 12);
  for (let i = 0; i < n; i++) {
    const o = s.rawPtr + i * 12;
    const begin = buf.readUInt32LE(o);
    const end = buf.readUInt32LE(o + 4);
    if (begin && end > begin) pdata.push({ begin, end });
  }
  pdata.sort((a, b) => a.begin - b.begin);
  console.log(`  ${pdata.length} functions in .pdata`);
}

/** The function containing `rva`, or null if it falls outside every range. */
function containingFunction(rva) {
  let lo = 0;
  let hi = pdata.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const f = pdata[mid];
    if (rva < f.begin) hi = mid - 1;
    else if (rva >= f.end) lo = mid + 1;
    else return f;
  }
  return null;
}

// --- sections ----------------------------------------------------------------
console.log("reading GameAssembly.dll...");
const buf = fs.readFileSync(DLL);
const pe = buf.readUInt32LE(0x3c);
const nSections = buf.readUInt16LE(pe + 6);
const optSize = buf.readUInt16LE(pe + 20);
const sections = [];
for (let i = 0; i < nSections; i++) {
  const o = pe + 0x18 + optSize + i * 40;
  sections.push({
    name: buf.toString("ascii", o, o + 8).replace(/\0+$/, ""),
    vaddr: buf.readUInt32LE(o + 12),
    rawPtr: buf.readUInt32LE(o + 20),
    rawSize: buf.readUInt32LE(o + 16),
    exec: (buf.readUInt32LE(o + 36) & 0x20000000) !== 0,
  });
}

loadPdata(buf, sections);

// --- instruction-shape filter ------------------------------------------------

/** Opcodes that load/store a byte, dword or float from memory -- what a field
 *  read looks like. Checked one or two bytes before the ModRM, allowing a REX
 *  prefix and the 0F escape. */
function plausibleOpcode(b, i) {
  if (i < 0) return false;
  const op = b[i];
  // mov r/m: 88 89 8A 8B ; movzx/movsx: 0F B6 0F B7 0F BE 0F BF ; cmp/test: 38 39 3A 3B 84 85
  if (op === 0x88 || op === 0x89 || op === 0x8a || op === 0x8b) return true;
  if (op === 0x38 || op === 0x39 || op === 0x3a || op === 0x3b) return true;
  if (op === 0x84 || op === 0x85 || op === 0x80 || op === 0x81 || op === 0x83) return true;
  if (op === 0xc6 || op === 0xc7) return true; // mov r/m, imm
  if (i >= 1 && b[i - 1] === 0x0f) {
    return op === 0xb6 || op === 0xb7 || op === 0xbe || op === 0xbf || op === 0x10 || op === 0x11;
  }
  return false;
}

/** True if the 4 bytes at `at` sit where a disp32 memory displacement belongs. */
function isDisp32Operand(b, at) {
  // form 1: [opcode] [ModRM mod=10, rm != 100] [disp32]
  const modrm = b[at - 1];
  if (modrm !== undefined && (modrm & 0xc0) === 0x80 && (modrm & 0x07) !== 0x04) {
    // skip a possible REX prefix when locating the opcode
    if (plausibleOpcode(b, at - 2)) return true;
    if ((b[at - 3] & 0xf0) === 0x40 && plausibleOpcode(b, at - 2)) return true;
  }
  // form 2: [opcode] [ModRM mod=10, rm == 100] [SIB] [disp32]
  const modrm2 = b[at - 2];
  if (modrm2 !== undefined && (modrm2 & 0xc0) === 0x80 && (modrm2 & 0x07) === 0x04) {
    if (plausibleOpcode(b, at - 3)) return true;
    if ((b[at - 4] & 0xf0) === 0x40 && plausibleOpcode(b, at - 3)) return true;
  }
  return false;
}

// --- scan --------------------------------------------------------------------
// hits: rva -> Set(field names)
const perMethod = new Map();
let totalHits = 0;

for (const s of sections) {
  if (!s.exec || !s.rawSize) continue;
  if (s.name === ".upx0") continue; // protector VM, not game code
  console.log(`scanning ${s.name} (${(s.rawSize / 1048576).toFixed(0)} MB)...`);

  for (const [off, fieldName] of FIELDS) {
    const needle = Buffer.alloc(4);
    needle.writeUInt32LE(off);
    let from = s.rawPtr;
    const end = s.rawPtr + s.rawSize;
    for (;;) {
      const at = buf.indexOf(needle, from);
      if (at < 0 || at >= end) break;
      from = at + 1;
      // Raw 4-byte matches are mostly coincidence. Require the bytes to
      // actually be the disp32 of a memory operand: the preceding byte must be
      // a ModRM with mod=10 (disp32 follows), or a SIB whose ModRM is mod=10.
      if (!isDisp32Operand(buf, at)) continue;
      const rva = s.vaddr + (at - s.rawPtr);
      // .pdata is mangled by the protector (only ~9% of entries are sane), so
      // use our own dumped method RVAs as function starts instead, and refuse
      // to attribute a hit that lies further past one than any real il2cpp
      // method body plausibly extends.
      const m = nearestMethod(rva);
      if (!m) continue;
      const offsetIntoBody = rva - m.rva;
      if (offsetIntoBody > 0x2000) continue;
      let rec = perMethod.get(m.rva);
      if (!rec) {
        rec = { fn: { begin: m.rva }, m, size: 0, fields: new Set(), count: 0 };
        perMethod.set(m.rva, rec);
      }
      if (offsetIntoBody > rec.size) rec.size = offsetIntoBody;
      rec.fields.add(fieldName);
      rec.count++;
      totalHits++;
    }
  }
}

console.log(`\n${totalHits} raw displacement hits across ${perMethod.size} methods`);

const ranked = [...perMethod.values()]
  .filter((r) => r.fields.size >= 5 && r.size < 0x4000)
  .sort((a, b) => b.fields.size - a.fields.size || a.size - b.size);

console.log(`${ranked.length} functions reference 5+ distinct AttackProperty fields
`);
for (const r of ranked.slice(0, 30)) {
  const label = r.m ? `${r.m.cls}::${r.m.name}(${r.m.args})` : "<no managed method at this address>";
  console.log(`0x${r.fn.begin.toString(16)}  size=0x${r.size.toString(16)}  ${r.fields.size} fields / ${r.count} refs  ${label}`);
  console.log(`    ${[...r.fields].join(", ")}`);
}

fs.writeFileSync(
  path.join(root, "claude-attackprop-consumers.json"),
  JSON.stringify(
    ranked.slice(0, 300).map((r) => ({
      rva: "0x" + r.fn.begin.toString(16),
      size: r.size,
      cls: r.m ? r.m.cls : null,
      method: r.m ? r.m.name : null,
      args: r.m ? r.m.args : null,
      fieldCount: r.fields.size,
      refs: r.count,
      fields: [...r.fields],
    })),
    null,
    2,
  ),
);
console.log("wrote claude-attackprop-consumers.json");
