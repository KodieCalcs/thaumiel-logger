// RFC-style quoted cells, including escaped quotes and embedded line breaks.
export function parseCsv(text) {
  const records = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(cell.replace(/\r$/, '')); cell = '';
      if (c === '\n') { records.push(row); row = []; }
    } else cell += c;
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  if (cell || row.length) { row.push(cell); records.push(row); }
  const header = records.shift() || [];
  return records.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
