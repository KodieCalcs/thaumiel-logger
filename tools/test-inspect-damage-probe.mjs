import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url));
const temp=mkdtempSync(join(here,'probe-test-'));
try{
  const b=Buffer.alloc(8); b.writeFloatLE(1234.5);
  const word=`0x${b.readBigUInt64LE().toString(16)}`;
  const path=join(temp,'sample.tsv');
  writeFileSync(path,`# schema=1\nsequence\telapsed_ms\tcaller_rva\tstack_bytes\targ1_bytes\targ4\targ1_mem0\n1\t100\t0xabc\t8\t0\t${word}\t${word}\nincomplete\n`);
  const result=execFileSync(process.execPath,[join(here,'inspect-damage-probe.mjs'),path,'1234'],{encoding:'utf8'});
  assert.match(result,/arg4\/f32low=1234.5/);
  assert.doesNotMatch(result,/arg1_mem0\//); // unreadable pointer bytes must not become candidates
  assert.match(result,/"incomplete": 1/);
  console.log('PASS: candidate float decoding, unreadable-memory exclusion, truncated row detection');
}finally{rmSync(temp,{recursive:true});}
