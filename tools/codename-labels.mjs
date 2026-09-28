import fs from 'node:fs';
const table = JSON.parse(fs.readFileSync(new URL('./codenames.json', import.meta.url), 'utf8')).names;
const codes = Object.keys(table).sort((a, b) => b.length - a.length);
export function codename(value = '') {
  const known = codes.find((code) => value === code || value.startsWith(code + '_'));
  if (known) return known;
  // Unknown entities retain their raw codename, including the Bangboo/Monster namespace.
  return value.match(/^(?:(?:Bangboo|Monster)_)?[^_]+/)?.[0] || '';
}
export const displayName = (code) => table[code]?.name || code;
export function stripCodename(value) {
  const code = codename(value);
  return value.startsWith(code + '_') ? value.slice(code.length + 1) : value;
}
