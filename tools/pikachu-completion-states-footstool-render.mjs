/** One durable, task-owned local render. Never accepts art or clears a queue. */
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { spawnSync } from 'node:child_process';

// Batch only previously inspected inputs, strictly one child/GPU job at a time.
// A failed/ambiguous submission stops the batch; no retries or auto-acceptance.
if (process.argv[2] === '--batch') {
  const keys = process.argv.slice(3);
  if (!keys.length || new Set(keys).size !== keys.length
    || keys.some(key => !/^(fair|normal|thunder|full|tiled)-[a-z0-9-]+-source\d+$/.test(key))) throw new Error('Expected unique prepared Pikachu pose keys');
  for (const key of keys) {
    const result = spawnSync(process.execPath, [import.meta.filename, key], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  process.exit(0);
}

const key = process.argv[2];
if (!/^(fair|normal|thunder|full|tiled)-[a-z0-9-]+-source\d+$/.test(key ?? '')) throw new Error('Expected a prepared Pikachu pose key');
const attemptArg=process.argv[3];
if(attemptArg && !/^--attempt=[123]$/.test(attemptArg)) throw new Error('Expected --attempt=1,2,3');
const attempt=attemptArg?Number(attemptArg.split('=')[1]):1;
const base = path.resolve(import.meta.dirname, '../docs/review/2026-10-06/pikachu-character/art/completion-states-footstool');
const server = 'http://127.0.0.1:8188';
const job = `${key}-attempt${attempt}`;
const family = key.startsWith('fair-') ? 'fair' : key.startsWith('thunder-') ? 'thunder' : key.startsWith('full-') ? 'full' : key.startsWith('tiled-') ? 'tiled' : 'normal';
const preparation = JSON.parse(readFileSync(path.join(base, `${family}-pilot-preparation.json`), 'utf8'));
const poseRecord = preparation.records.find(row => row.key === key);
const record = attempt===1?poseRecord:poseRecord?.attempts?.[attempt];
const coordinates = record?.coordinate_contract ?? preparation.coordinate_contract;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// A CPU atlas preparer writes its snapshot only after finishing a family. Keep
// independently inspected, hash-bound receipts separate rather than racing it.
const inputReceiptPath = path.join(base, 'tiled-expansion-input-reviews.json');
const inputReceipt = family === 'tiled' && existsSync(inputReceiptPath)
  ? JSON.parse(readFileSync(inputReceiptPath, 'utf8')).records?.[key] : null;
const reviewedAtlas = path.join(base, `${key}-input-review.png`);
const receiptMatches = inputReceipt?.state === 'inputs_visually_reviewed'
  && inputReceipt.reviewer && existsSync(reviewedAtlas)
  && inputReceipt.inputReviewSha256 === sha(readFileSync(reviewedAtlas))
  && inputReceipt.inputReviewSha256 === record?.input_review_sha256;
if (!record?.upload_mapping || (record.state !== 'inputs_visually_reviewed' && !receiptMatches)) throw new Error('Input visual review is required before rendering');
const ledgerPath = path.join(base, `${family}-generation-ledger.json`);
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
let entry = ledger.find(row => row.job_key === job);
if (entry?.state === 'accepted' || entry?.state === 'rejected') throw new Error('Reviewed attempt is immutable; do not render it again');
const workflowPath = path.join(base, record.workflow);
const workflow = JSON.parse(readFileSync(workflowPath, 'utf8'));
if (family === 'thunder') {
  const guideReview = JSON.parse(readFileSync(path.join(base, 'thunder-control-guide-review.json'), 'utf8'));
  if (guideReview.state !== 'actual_control_guides_visually_reviewed'
    || guideReview.preparationSha256 !== sha(readFileSync(path.join(base, 'thunder-pilot-preparation.json')))
    || guideReview.guides[key] !== record.hashes?.guide)
    throw new Error('Actual Thunder body guide inspection is required');
}
if (family !== 'fair') {
  for (const kind of ['seed','guide','render-mask']) {
    const input=record.input_files?.[kind]??`${key}-${kind}.png`;
    if (!record.hashes?.[kind] || sha(readFileSync(path.join(base,input))) !== record.hashes[kind])
      throw new Error(`Changed or missing reviewed normal input: ${key}/${kind}`);
  }
  const sourcePath = path.resolve(import.meta.dirname,'..',record.source_path);
  if (sha(readFileSync(sourcePath)) !== record.source_sha256) throw new Error('Changed normal motion source');
}
const persist = () => {
  // Manual review may finish another pose while this serial GPU job runs.
  // Refresh those rows so this child's earlier snapshot cannot erase reviews.
  const current = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  for (const row of current) {
    if (row.job_key === job) continue;
    const index = ledger.findIndex(item => item.job_key === row.job_key);
    if (index === -1) ledger.push(row);
    else ledger[index] = row;
  }
  const temporary = `${ledgerPath}.${job}.tmp`;
  writeFileSync(temporary, JSON.stringify(ledger, null, 2) + '\n');
  renameSync(temporary, ledgerPath);
};
const request = async (route, options = {}) => {
  // Retry read-only observation timeouts, never an ambiguous POST submission.
  const readOnly = !options.method || options.method === 'GET';
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${server}${route}`, { ...options, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`${route}: HTTP ${response.status} ${await response.text()}`);
      return response;
    } catch (error) {
      if (!readOnly || attempt >= 3 || !['TimeoutError', 'AbortError', 'TypeError'].includes(error.name)) throw error;
      console.log(`${job}: read-only ${route} observation retry${attempt + 1}; existing prompt retained`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
};
const saveJson = (file, value) => writeFileSync(path.join(base, file), JSON.stringify(value, null, 2) + '\n');
const queue = await (await request('/queue')).json();
saveJson(`${job}.queue-before.json`, queue);
if (!entry) {
  if (queue.queue_running.length || queue.queue_pending.length) throw new Error('Local queue is occupied; no submission');
  if(attempt>1 && !ledger.some(row=>row.pose_key===key && row.attempt===attempt-1 && row.state==='rejected')) throw new Error('Prior attempt needs explicit rejection before correction');
  entry = { job_key: job, pose_key: key, attempt, state: 'prepared', server,
    prepared_at: new Date().toISOString(), workflow_sha256: sha(readFileSync(workflowPath)),
    source_index: record.source_index, hold_game: record.hold_game,
    canvas: coordinates.canvas, root: coordinates.root,
    world_scale: coordinates.world_scale, final_node: '9', diagnostic_node: '20',
    input_review: `${key}-input-review.png`, authorization: 'User requested all remaining Pikachu work; established local ComfyUI beta recipe',
    acceptance: 'Pending generated anatomy/alpha/root inspection and actual renderer qualification' };
  ledger.push(entry); persist();
}
if (entry.workflow_sha256 !== sha(readFileSync(workflowPath))) throw new Error('Prepared graph hash changed');
if (!entry.prompt_id) {
  if (entry.state === 'unresolved' || entry.state === 'submitting') throw new Error('Ambiguous prior submission: reconcile queue/history before any new job');
  for (const [remote, local] of Object.entries(record.upload_mapping)) {
    const uploadPath = path.join(base, `${job}.upload-${local}.json`);
    let result;
    if (existsSync(uploadPath)) result = JSON.parse(readFileSync(uploadPath, 'utf8'));
    else {
      const bytes = readFileSync(path.join(base, local));
      const form = new FormData();
      form.set('image', new Blob([bytes], { type: 'image/png' }), remote);
      form.set('type', 'input'); form.set('overwrite', 'false');
      result = await (await request('/upload/image', { method: 'POST', body: form })).json();
      saveJson(path.basename(uploadPath), result);
    }
    if (result.name !== remote || result.subfolder) throw new Error(`Upload returned a different image name: ${remote}`);
  }
  entry.state = 'submitting'; entry.submission_started_at = new Date().toISOString(); persist();
  try {
    const result = await (await request('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: `pf-pikachu-${key}` }) })).json();
    saveJson(`${job}.submission.json`, result);
    if (!result.prompt_id) throw new Error(`No prompt ID: ${JSON.stringify(result)}`);
    entry.prompt_id = result.prompt_id; entry.state = 'submitted'; entry.submitted_at = new Date().toISOString(); persist();
  } catch (error) { entry.state = 'unresolved'; entry.error = String(error); persist(); throw error; }
}
console.log(`${job}: observing prompt ${entry.prompt_id}`);
const deadline = Date.now() + 15 * 60 * 1000;
let lastProgress = 0;
while (Date.now() < deadline) {
  const history = await (await request(`/history/${entry.prompt_id}`)).json();
  const result = history[entry.prompt_id];
  if (result?.status?.completed) {
    saveJson(`${job}.history.json`, history);
    if (result.status.status_str !== 'success') {
      entry.state = 'failed'; entry.failure = result.status; persist(); throw new Error('ComfyUI render failed; inspect saved history');
    }
    entry.state = 'succeeded'; entry.outputs = {}; persist();
    for (const [node, suffix] of [['9', ''], ['20', '-raw']]) {
      const images = result.outputs[node]?.images;
      if (images?.length !== 1) throw new Error(`Expected one explicit output from node ${node}`);
      const image = images[0];
      const bytes = Buffer.from(await (await request(`/view?${new URLSearchParams(image)}`)).arrayBuffer());
      const png = PNG.sync.read(bytes);
      if (png.width !== entry.canvas[0] || png.height !== entry.canvas[1]) throw new Error('Render canvas mismatch');
      const file = `${job}${suffix}.png`; writeFileSync(path.join(base, file), bytes);
      entry.outputs[node] = { ...image, file, sha256: sha(bytes) }; persist();
    }
    const final = PNG.sync.read(readFileSync(path.join(base, `${job}.png`)));
    let keyed = 0;
    for (let i = 0; i < final.data.length; i += 4) {
      if (Math.abs(final.data[i] - 204) <= 28 && Math.abs(final.data[i + 1] - 73) <= 28 && Math.abs(final.data[i + 2] - 140) <= 28) {
        final.data[i + 3] = 0; keyed++;
      }
    }
    const cutout = `${job}-cutout.png`, bytes = PNG.sync.write(final);
    writeFileSync(path.join(base, cutout), bytes);
    entry.outputs.cutout = { file: cutout, sha256: sha(bytes), process: 'keycc498c/tolerance28/no-despill; no resize or recenter', transparent_fraction: keyed / (final.width * final.height) };
    entry.completed_at = new Date().toISOString(); persist();
    console.log(`${job}: succeeded, cutout ${(100 * keyed / (final.width * final.height)).toFixed(2)}% transparent; visual review still pending`);
    process.exit(0);
  }
  if (Date.now() - lastProgress > 30000) { console.log(`${job}: render still pending`); lastProgress = Date.now(); }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
entry.state = 'unresolved'; entry.error = 'Observation deadline exceeded; do not resubmit'; persist();
throw new Error(entry.error);
