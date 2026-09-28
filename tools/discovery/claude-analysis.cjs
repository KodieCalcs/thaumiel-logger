// Structure-first look at the v6 dump, rather than guessing at names.
//   node claude-analysis.cjs <mode>
// modes: enum <ClassName> | ns | classes <regex> | methods <regex> | fieldset <regex>
const fs = require("fs");
const path = require("path");

const TSV = path.join(__dirname, "il2cpp-v6.tsv");
const mode = process.argv[2];
const arg = process.argv[3];

// Parse into classes lazily; the file is ~50 MB so one pass, minimal retention.
function* classes() {
  const text = fs.readFileSync(TSV, "utf8");
  let cur = null;
  for (const row of text.split(/\r?\n/)) {
    if (row.startsWith("CLASS\t")) {
      if (cur) yield cur;
      const p = row.split("\t");
      cur = { asm: p[1], idx: p[2], ns: p[3], name: p[4], ptr: p[5], fields: [], methods: [] };
    } else if (cur && row.startsWith("FIELD\t")) {
      const p = row.split("\t");
      cur.fields.push({ name: p[1], off: p[2] });
    } else if (cur && row.startsWith("METHOD\t")) {
      const p = row.split("\t");
      cur.methods.push({ name: p[1], args: p[2], rva: p[4] });
    }
  }
  if (cur) yield cur;
}

const full = (c) => (c.ns ? `${c.ns}.${c.name}` : c.name);

if (mode === "enum") {
  for (const c of classes()) {
    if (full(c) !== arg && c.name !== arg) continue;
    console.log(`${full(c)}  (${c.fields.length} members, ${c.methods.length} methods)`);
    for (const f of c.fields) console.log(`  ${f.off}\t${f.name}`);
  }
} else if (mode === "ns") {
  const counts = new Map();
  for (const c of classes()) {
    const ns = c.ns || "(global)";
    counts.set(ns, (counts.get(ns) || 0) + 1);
  }
  for (const [ns, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 60))
    console.log(String(n).padStart(6), ns);
} else if (mode === "classes") {
  const re = new RegExp(arg, "i");
  for (const c of classes())
    if (re.test(full(c)))
      console.log(`${full(c)}\tfields=${c.fields.length}\tmethods=${c.methods.length}`);
} else if (mode === "methods") {
  const re = new RegExp(arg, "i");
  for (const c of classes())
    for (const m of c.methods)
      if (re.test(m.name)) console.log(`${full(c)}\t${m.name}(${m.args})\t${m.rva}`);
} else if (mode === "fieldset") {
  // Classes whose FIELD names collectively look like a damage record.
  const wanted = (arg || "damage,breakstun,element,pen,atk,crit,hit").split(",");
  const out = [];
  for (const c of classes()) {
    if (c.fields.length < 4 || c.fields.length > 120) continue;
    const names = c.fields.map((f) => f.name.toLowerCase());
    const score = wanted.filter((wd) => names.some((n) => n.includes(wd))).length;
    if (score >= 4) out.push({ c, score });
  }
  out.sort((a, b) => b.score - a.score || a.c.fields.length - b.c.fields.length);
  for (const { c, score } of out.slice(0, 40)) {
    console.log(`\n== ${full(c)}  score=${score}  fields=${c.fields.length}`);
    for (const f of c.fields.slice(0, 40)) console.log(`   ${f.off}\t${f.name}`);
  }
} else {
  console.error("modes: enum <Class> | ns | classes <re> | methods <re> | fieldset [words]");
  process.exit(2);
}
