/** One enlarged-canvas pilot after the existing serial normal batch.
 * Does not expand the Thunder batch or accept its output. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const base = path.join(root, 'docs/review/2026-10-06/pikachu-character/art');
const plan = JSON.parse(readFileSync(path.join(base, 'thunder-pilot-render-plan.json')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (plan.prerequisiteNormalKeys.length !== 72 || plan.key !== 'thunder-ground-sample0-source0'
  || sha(readFileSync(path.join(base, plan.inputReview))) !== plan.inputReviewSha256)
  throw new Error('Changed single-pilot plan or reviewed inputs');
const finished = (ledger, key) => ledger.some(row => row.pose_key === key
  && ['succeeded', 'accepted'].includes(row.state) && row.outputs?.cutout?.sha256);
const deadline = Date.now() + 2 * 60 * 60 * 1000;
let previousCount = -1;
while (true) {
  if (Date.now() > deadline) throw new Error('Prerequisite timeout; pilot not submitted');
  // The normal renderer can rewrite this ledger while the waiter reads it.
  // A partial JSON read must never count as a completed prerequisite.
  const ledgerBytes = readFileSync(path.join(base, 'normal-generation-ledger.json'));
  let ledger;
  try {
    ledger = JSON.parse(ledgerBytes);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    console.log('Normal ledger update in progress; retrying before any pilot submission');
    await new Promise(resolve => setTimeout(resolve, 5000));
    continue;
  }
  const count = plan.prerequisiteNormalKeys.filter(key => finished(ledger, key)).length;
  if (count !== previousCount) {
    console.log(`Waiting for existing normal renders: ${count}/72; Thunder GPU queue untouched`);
    previousCount = count;
  }
  if (count === 72) break;
  const failure = ledger.find(row => plan.prerequisiteNormalKeys.includes(row.pose_key)
    && ['failed', 'unresolved'].includes(row.state) && !finished(ledger, row.pose_key));
  if (failure) throw new Error(`Prerequisite failed/ambiguous at ${failure.pose_key}; pilot not submitted`);
  if (Date.now() > deadline) throw new Error('Prerequisite timeout; pilot not submitted');
  await new Promise(resolve => setTimeout(resolve, 5000));
}
const ledger = JSON.parse(readFileSync(path.join(base, 'thunder-generation-ledger.json')));
if (!finished(ledger, plan.key)) {
  const result = spawnSync(process.execPath, ['tools/pikachu-art-render.mjs', plan.key], { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error ?? new Error('Thunder pilot failed; no batch expansion');
}
console.log('Single Thunder body pilot acquired. Actual visual inspection required before remaining31 drawings.');
