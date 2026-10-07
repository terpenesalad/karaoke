// Runs every test file in this folder; exits non-zero if any fail.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const f of readdirSync(dir).filter(f => /\.test\.(m?js)$/.test(f)).sort()) {
  console.log(`\n${f}`);
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) failed` : '\nAll tests passed');
process.exit(failed ? 1 : 0);
