// Schema-less protobuf walker. node pbwalk.mjs <file.pb> [maxDepth]
import fs from "node:fs";
const buf = fs.readFileSync(process.argv[2]);
const maxDepth = parseInt(process.argv[3] || "8");

function readVarint(b, p) { let r = 0n, s = 0n, i = p; for (;;) { if (i >= b.length) throw 0; const c = b[i++]; r |= BigInt(c & 0x7f) << s; if (!(c & 0x80)) break; s += 7n; if (s > 70n) throw 0; } return [r, i]; }
function parse(b) { // returns array of {f, wt, v} or throws
  const out = []; let p = 0;
  while (p < b.length) {
    let tag; [tag, p] = readVarint(b, p); const f = Number(tag >> 3n), wt = Number(tag & 7n);
    if (f === 0 || f > 2000) throw 0;
    if (wt === 0) { let v; [v, p] = readVarint(b, p); out.push({ f, wt, v }); }
    else if (wt === 1) { if (p + 8 > b.length) throw 0; out.push({ f, wt, v: b.subarray(p, p + 8) }); p += 8; }
    else if (wt === 5) { if (p + 4 > b.length) throw 0; out.push({ f, wt, v: b.subarray(p, p + 4) }); p += 4; }
    else if (wt === 2) { let n; [n, p] = readVarint(b, p); n = Number(n); if (p + n > b.length) throw 0; out.push({ f, wt, v: b.subarray(p, p + n) }); p += n; }
    else throw 0;
  }
  return out;
}
function isText(b) { if (!b.length) return false; for (const c of b) if (c < 0x20 || c > 0x7e) return false; return true; }
function packedVarints(b) { try { const out = []; let p = 0; while (p < b.length) { let v; [v, p] = readVarint(b, p); out.push(Number(v)); } return out; } catch { return null; } }
function show(b, depth, indent) {
  let fields; try { fields = parse(b); } catch { console.log(indent + "<bytes " + b.length + ">"); return; }
  for (const { f, wt, v } of fields) {
    if (wt === 0) console.log(`${indent}${f}: ${v}`);
    else if (wt === 1) console.log(`${indent}${f}: f64=${v.readDoubleLE(0)} i64=${v.readBigInt64LE(0)}`);
    else if (wt === 5) console.log(`${indent}${f}: f32=${v.readFloatLE(0)} i32=${v.readInt32LE(0)}`);
    else {
      if (isText(v)) { console.log(`${indent}${f}: "${v.toString()}"`); continue; }
      let nested = null; try { nested = parse(v); } catch {}
      const looksMsg = nested && nested.length > 0 && nested.every((x) => x.f < 200);
      if (looksMsg && depth < maxDepth) { console.log(`${indent}${f}: {`); show(v, depth + 1, indent + "  "); console.log(`${indent}}`); }
      else { const pk = packedVarints(v); console.log(`${indent}${f}: ${pk ? "packed[" + pk.join(",") + "]" : "<bytes " + v.length + ">"}`); }
    }
  }
}
show(buf, 0, "");
