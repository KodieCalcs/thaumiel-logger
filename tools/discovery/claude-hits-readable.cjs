// Turn hits.tsv into a human-readable CSV suitable for sharing.
//
//   node claude-hits-readable.cjs hits.tsv hits-readable.csv
//
// Only mappings we actually grounded are applied. Anything unverified keeps its
// raw numeric value rather than being guessed at.
const fs = require("fs");

const inPath = process.argv[2] || "hits.tsv";
const outPath = process.argv[3] || "hits-readable.csv";

// Agent, from the skill-id prefix (skill ids are <avatarId><nnn>).
const AGENTS = { 1181: "Grace", 1211: "Rina", 1561: "Velina", 5400: "Bangboo" };

// Actions. Each of these was confirmed in this session by matching the observed
// split fractions / timing against the decoded asset data -- see
// docs/reference/hit-split-frame-data.md.
const ACTIONS = {
  1561006: "EX Special: Eye of the Storm",
  1561009: "EX Special: Purifying Rise",
  1561007: "Wind Region (cyclone, 0.5s ticks)",
  1561001: "Basic Attack",
  1561002: "Basic Attack",
  1561003: "Basic Attack",
  1561011: "Basic Attack",
  1211009: "EX Special",
  1181011: "Quick Assist",
  5400801: "Bangboo Attack",
  112303: "Enemy Attack (Cottus)",
  112301: "Enemy Attack (Cottus)",
  // Identified as that agent's by the skill-id prefix, and the split pattern is
  // recorded, but the specific ability name was never verified -- so they are
  // labelled by id rather than guessed at.
  1181001: "Basic chain (3 x 1/3)",
  1181002: "Basic chain (3 x 1/3)",
  1181003: "Basic chain (5 x 0.08, + 0.30 Electric finisher)",
  1181004: "Basic chain (8 x 0.125)",
  1181007: "Attack (3 x 1/3)",
  1181016: "Assist follow-up (2 x 0.50)",
  1181017: "Assist follow-up (6 x 1/3)",
  1211010: "Attack (single)",
  1211011: "Doll volley (10 x 0.10)",
  1211012: "Doll volley (10 x 0.10)",
  1211023: "Attack (3 x 1/3)",
  1211024: "Attack (5 x 0.143)",
};

// Grounded: 200 from Grace's basics (confirmed Physical by the player), 203 from
// Grace's Quick Assist and Rina's EX (both Electric agents), 204 from every
// Velina row (and her asset data's DamageElement: 204). Other codes unseen, so
// unmapped.
const ELEMENTS = { 200: "Physical", 203: "Electric", 204: "Wind" };

// DamageHitType enum members are Pierce / Cut / Punch / None, but the dump does
// not carry their numeric values, so 101/102/103 are left raw deliberately.

const lines = fs.readFileSync(inPath, "utf8").trim().split(/\r?\n/);
const head = lines[0].split("\t");
const rows = lines.slice(1).map((l) => {
  const p = l.split("\t");
  const o = {};
  head.forEach((h, i) => (o[h] = p[i]));
  return o;
});

const t0 = Number(rows[0].elapsed_ms);

// Group into casts *per skill*, not per consecutive row -- two agents' actions
// interleave constantly (Rina's EX ticks between Grace's Quick Assist hits), and
// treating that as separate casts makes the output unreadable.
const state = new Map(); // skillId -> { cast, lastMs, hit }
let castNo = 0;
// `share` is the single fraction the game applies to damage, Daze, anomaly
// buildup and Energy alike -- verified: the five *Pct columns in hits.tsv are
// identical in 64 of 64 rows, because they all come from one
// ConfigAttackActiveFrameDynamicProp value.
const out = [
  "time_s,agent,action,cast,hit,share,heavy,causes_stun,element,damage_hit_type,skill_id",
];

for (const r of rows) {
  const ms = Number(r.elapsed_ms);
  const skill = r.skillId;
  let st = state.get(skill);
  if (!st || ms - st.lastMs > 2000) {
    st = { cast: ++castNo, hit: 0, lastMs: ms };
    state.set(skill, st);
  }
  st.hit++;
  st.lastMs = ms;
  const hitNo = st.hit;
  const cast = st.cast;

  const prefix4 = skill.slice(0, 4);
  const agent = AGENTS[prefix4] || (skill === "0" ? "" : "Unknown");
  const action = ACTIONS[skill] || (skill === "0" ? "(no attack property)" : `Skill ${skill}`);
  const el = ELEMENTS[r.element] || (r.element === "0" ? "" : r.element);

  out.push(
    [
      ((ms - t0) / 1000).toFixed(3),
      agent,
      `"${action}"`,
      cast,
      hitNo,
      Number(r.dmgPct).toFixed(4),
      Number(r.dazePct).toFixed(4),
      Number(r.buildupPct).toFixed(4),
      Number(r.epPct).toFixed(4),
      r.heavy === "1" ? "yes" : "",
      r.causeStun === "1" ? "yes" : "",
      el,
      r.hitType,
      skill,
    ].join(","),
  );
}

fs.writeFileSync(outPath, out.join("\n") + "\n");
console.log(`wrote ${outPath}: ${rows.length} hits`);
