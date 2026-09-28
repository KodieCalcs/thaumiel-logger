// Offline unwind of damage-event rows (schema 2: rsp_entry + raw stack words) against the saved
// CNBetaWin3.3.0 GameAssembly.dll. No .pdata is used (it is mangled); frames are walked from
// prologues instead:
//   - a return address R lies inside function F; F's start is found by scanning backwards from R
//     for il2cpp's inter-function padding (a run of 0xCC) or a preceding `ret`;
//   - F's prologue (push r64*, optional mov/lea rbp, sub rsp imm) gives its frame size;
//   - the slot holding F's own return address is entry_rsp(F) = slot(R) + 8 + frame(F).
// Each step is checked: the word found must look like a return address (executable, preceded
// by a call). The walk stops at the first inconsistency and says so.
//
//   node unwind-event-stack.mjs <damage-event-*.tsv> <GameAssembly.dll> <il2cpp-v7.tsv> [rows]
import { readFileSync, openSync, readSync } from 'node:fs';

const [capture, dllPath, dump, rowsArg] = process.argv.slice(2);
const SELFTEST = capture === "--selftest";
if (!SELFTEST && (!capture || !dllPath || !dump)) { console.error('usage: unwind-event-stack.mjs <capture> <GameAssembly.dll> <il2cpp-v7.tsv> [maxRows]'); process.exit(2); }

// --- saved binary: RVA -> file bytes ---------------------------------------------------------
const fd = openSync(dllPath, 'r');
const hdr = Buffer.alloc(0x1000); readSync(fd, hdr, 0, hdr.length, 0);
const e_lfanew = hdr.readUInt32LE(0x3c);
const nsec = hdr.readUInt16LE(e_lfanew + 6), optSize = hdr.readUInt16LE(e_lfanew + 20);
const secBase = e_lfanew + 24 + optSize;
const sections = [];
for (let i = 0; i < nsec; i++) {
  const o = secBase + i * 40;
  sections.push({ name: hdr.toString('latin1', o, o + 8).replace(/\0+$/, ''), va: hdr.readUInt32LE(o + 12), vsize: hdr.readUInt32LE(o + 8), raw: hdr.readUInt32LE(o + 20), rawSize: hdr.readUInt32LE(o + 16), chars: hdr.readUInt32LE(o + 36) });
}
const execSecs = sections.filter(s => s.chars & 0x20000000);
const inExec = (rva) => execSecs.some(s => rva >= s.va && rva < s.va + s.vsize);
const readRva = (rva, n) => {
  const s = sections.find(s => rva >= s.va && rva < s.va + s.vsize); if (!s) return null;
  const off = s.raw + (rva - s.va); const b = Buffer.alloc(n); const got = readSync(fd, b, 0, n, off); return got === n ? b : b.subarray(0, got);
};
const isCallPreceded = (rva) => {
  const b = readRva(rva - 8, 8); if (!b || b.length < 8) return false;
  if (b[3] === 0xE8) return true;
  if (b[2] === 0xFF && (b[3] === 0x15 || (b[3] & 0xF8) === 0x90)) return true;
  if (b[5] === 0xFF && (b[6] & 0xF8) === 0x50) return true;
  if (b[6] === 0xFF && ((b[7] & 0xF8) === 0x10 || (b[7] & 0xF8) === 0xD0)) return true;
  if (b[5] === 0x41 && b[6] === 0xFF && ((b[7] & 0xF8) === 0x10 || (b[7] & 0xF8) === 0xD0)) return true;
  return false;
};

// --- function start + frame size from the prologue ------------------------------------------
// Length of a NOP encoding at b[i] (90, 66 90, 0F 1F /0 with any ModRM, with 66 prefixes), else 0.
function nopLen(b, i) {
  let k = i; while (b[k] === 0x66) k++;
  if (b[k] === 0x90) return k - i + 1;
  if (b[k] === 0x0F && b[k + 1] === 0x1F) {
    const modrm = b[k + 2], mod = modrm >> 6, rm = modrm & 7; let len = 3;
    if (mod !== 3 && rm === 4) len += 1;            // SIB
    if (mod === 1) len += 1; else if (mod === 2 || (mod === 0 && rm === 5)) len += 4;
    return k - i + len;
  }
  return 0;
}
export function findStart(rva, maxBack = 0x8000) {
  // Verified by contiguous disassembly from the exact metadata entry through this call.
  // This 43 KB function exceeds maxBack. Increasing the byte scan produced a false
  // prologue at 0x134e504a inside an instruction; do not treat that as a frame.
  if (rva === 0x134ED786) return { start: 0x134E33E0, ...parsePrologue(0x134E33E0) };
  // Walk back to a 0xCC run (il2cpp pads between functions) or `ret` (C3 / C2 iw) followed by a
  // plausible prologue byte. Returns the first candidate whose prologue parses.
  const b = readRva(rva - maxBack, maxBack); if (!b) return null;
  for (let i = b.length - 1; i > 0; i--) {
    const prevCC = b[i - 1] === 0xCC, prevRet = b[i - 1] === 0xC3;
    if (!prevCC && !prevRet) continue;
    // candidate start = first non-NOP byte after the padding
    let j = i, guard = 0; while (guard++ < 8) { const l = nopLen(b, j); if (!l) break; j += l; }
    const start = rva - maxBack + j;
    if (start > rva) continue;
    const p = parsePrologue(start);
    if (p && p.ok) return { start, ...p };
  }
  return null;
}
export function parsePrologue(start) {
  const b = readRva(start, 64); if (!b) return null;
  let i = 0, pushes = 0, sub = 0, ok = false;
  // home-register stores `mov [rsp+disp8], r64` (48/4C 89 xx 24 ib) may precede the pushes; no rsp change
  while ((b[i] === 0x48 || b[i] === 0x4C) && b[i + 1] === 0x89 && (b[i + 2] & 0xC7) === 0x44 && b[i + 3] === 0x24) i += 5;
  // pushes: 50-57, or 41 50-57
  for (;;) {
    if (b[i] >= 0x50 && b[i] <= 0x57) { pushes++; i += 1; continue; }
    if (b[i] === 0x41 && b[i + 1] >= 0x50 && b[i + 1] <= 0x57) { pushes++; i += 2; continue; }
    break;
  }
  if (pushes === 0 && !(b[i] === 0x48 && (b[i + 1] === 0x83 || b[i + 1] === 0x81) && b[i + 2] === 0xEC)) return { ok: false };
  // optional mov rbp,rsp (48 8B EC) / lea rbp,[rsp+d] (48 8D 6C 24 ib / 48 8D AC 24 id) — no rsp change
  if (b[i] === 0x48 && b[i + 1] === 0x8B && b[i + 2] === 0xEC) i += 3;
  else if (b[i] === 0x48 && b[i + 1] === 0x8D && b[i + 2] === 0x6C && b[i + 3] === 0x24) i += 5;
  else if (b[i] === 0x48 && b[i + 1] === 0x8D && b[i + 2] === 0xAC && b[i + 3] === 0x24) i += 8;
  // sub rsp, imm8 / imm32
  if (b[i] === 0x48 && b[i + 1] === 0x83 && b[i + 2] === 0xEC) { sub = b[i + 3]; ok = true; }
  else if (b[i] === 0x48 && b[i + 1] === 0x81 && b[i + 2] === 0xEC) { sub = b.readUInt32LE(i + 3); ok = true; }
  else ok = pushes > 0; // leaf-ish: pushes only
  // and rsp,-N (alignment) after sub means a dynamic frame we cannot size
  const rest = b.subarray(i, i + 12);
  const dynamic = rest.includes(Buffer.from([0x48, 0x83, 0xE4])) || rest.includes(Buffer.from([0x48, 0x81, 0xE4]));
  return { ok: ok && !dynamic, pushes, sub, frame: pushes * 8 + sub, dynamic };
}

if (SELFTEST) {
  const publisher = findStart(0x134ED786);
  if (publisher?.start !== 0x134E33E0 || publisher.frame !== 0x2D8)
    throw new Error('enqueue publisher frame recovery failed');
  console.log('enqueue publisher recovered: start 0x134e33e0, frame 0x2d8');
  const a = parsePrologue(0x1482D830), b = parsePrologue(0x1482D390), c = findStart(0x1482D5B1), d = findStart(0x14830393);
  console.log("HBIMAECOHPC prologue", a, "expect pushes 8 sub 0x158");
  console.log("NMDONLEGPIN prologue", b);
  console.log("findStart(0x1482D5B1)", c && c.start.toString(16), "expect 1482d390");
  console.log("findStart(0x14830393)", d && d.start.toString(16), "expect 14830170 (BGGJIEPIODP)");
  console.log("callPreceded(0x1482D5B1)", isCallPreceded(0x1482D5B1), "callPreceded(0x1482D830)", isCallPreceded(0x1482D830), "expect true false");
  process.exit(0);
}

// --- dump: method starts for naming ---------------------------------------------------------
const methods = [];
{ let cls = ''; for (const line of readFileSync(dump, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('CLASS\t')) { const p = line.split('\t'); cls = (p[3] ? p[3] + '.' : '') + p[4]; continue; }
    if (!line.startsWith('METHOD\t')) continue; const p = line.split('\t'); const rva = parseInt(p[4], 16); if (rva) methods.push({ rva, name: cls + '::' + p[1], args: +p[2] });
  } methods.sort((a, b) => a.rva - b.rva); }
const nameAt = (rva) => { let lo = 0, hi = methods.length - 1, best = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (methods[m].rva <= rva) { best = m; lo = m + 1; } else hi = m - 1; } if (best < 0) return '?'; const d = rva - methods[best].rva; return d > 0x10000 ? `?(+0x${d.toString(16)} past ${methods[best].name})` : `${methods[best].name}(${methods[best].args})+0x${d.toString(16)}`; };
const exactName = (start) => { const m = methods.find(m => m.rva === start); return m ? `${m.name}(${m.args})` : null; };

// --- capture --------------------------------------------------------------------------------
const lines = readFileSync(capture, 'utf8').split(/\r?\n/).filter(l => l.length && !l.startsWith('#'));
const names = lines.shift().split('\t');
if (!names.includes('rsp_entry')) { console.error('capture has no rsp_entry/raw columns (needs event probe schema 2)'); process.exit(1); }
const rawIdx = names.indexOf('raw0'), rawCount = names.filter(n => /^raw\d+$/.test(n)).length;
let moduleBase = null;
const rows = lines.map(l => l.split('\t')).filter(v => v.length === names.length).slice(0, +(rowsArg || 5));
const col = (v, n) => v[names.indexOf(n)];

for (const v of rows) {
  const rsp = BigInt(col(v, 'rsp_entry')); const raw = []; for (let i = 0; i < rawCount; i++) raw.push(BigInt(v[rawIdx + i] || '0x0'));
  const caller = BigInt(col(v, 'caller')), callerRva = BigInt(col(v, 'caller_rva'));
  if (moduleBase === null) moduleBase = caller - callerRva;
  const wordAt = (addr) => { const i = Number((addr - rsp) / 8n); return i >= 0 && i < raw.length ? raw[i] : null; };
  console.log(`\n== row ${col(v, 'sequence')} t=${col(v, 'elapsed_ms')} dmg=${col(v, 'f32_44')} attacker=${col(v, 'u32_14')} rsp=0x${rsp.toString(16)} raw_bytes=${col(v, 'raw_bytes')}`);
  // frame 0 is the hooked handler itself: its return address is at rsp (slot S1), inside NMDONLEGPIN
  let slot = rsp, depth = 0;
  while (depth < 12) {
    const R = wordAt(slot); if (R === null) { console.log(`   [${depth}] slot 0x${slot.toString(16)} beyond captured words`); break; }
    const rva = Number(R - moduleBase);
    if (!inExec(rva) || !isCallPreceded(rva)) { console.log(`   [${depth}] slot 0x${slot.toString(16)} = 0x${rva.toString(16)} is not a return address — stop`); break; }
    const f = findStart(rva);
    const label = f ? (exactName(f.start) ?? nameAt(f.start)) : nameAt(rva);
    console.log(`   [${depth}] ret 0x${rva.toString(16)} -> ${label}${f ? `  start 0x${f.start.toString(16)} frame ${f.pushes}*8+0x${f.sub.toString(16)}=0x${f.frame.toString(16)}` : '  (no prologue found)'}`);
    if (!f) break;
    slot = slot + 8n + BigInt(f.frame);
    depth++;
  }
}
