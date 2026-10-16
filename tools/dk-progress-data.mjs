import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export function dkProgress(root) {
  const file = path.join(root, 'docs/review/2026-09-25/donkeykong-character/inventory.json');
  const bytes = readFileSync(file);
  const inventory = JSON.parse(bytes);
  const counts = { implemented: 0, accepted: 0, verified: 0, complete: 0, notApplicable: 0 };
  for (const row of inventory.actions) {
    const p = row.progress;
    counts.implemented += Number(p.implementation === 'implemented' || p.implementation === 'complete');
    counts.accepted += Number(String(p.visuals ?? '').startsWith('accepted'));
    counts.verified += Number(p.runtime === 'verified' || p.runtime === 'qualified_production_match');
    counts.complete += Number(p.complete === true && (p.required_gaps ?? []).length === 0);
    counts.notApplicable += Number(p.not_applicable === true);
  }
  const publicationFile = path.join(root, '.tmp/dk-live-gallery/publication.json');
  const publication = existsSync(publicationFile) ? JSON.parse(readFileSync(publicationFile, 'utf8')) : null;
  return { revision: createHash('sha256').update(bytes).digest('hex'), total: inventory.actions.length, publication,
    counts, baseline: inventory.baseline, activeWork: inventory.active_work, actions: inventory.actions.map(row => ({ id: row.id,
      family: row.family, progress: row.progress, fidelityLimits: row.fidelity_limits })) };
}
