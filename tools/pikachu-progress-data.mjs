/** Read live character evidence without changing its completion decisions. */
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function readPikachuProgress(root) {
  const evidence = path.join(root, 'docs/review/2026-10-06/pikachu-character');
  const inputs = [
    path.join(evidence, 'inventory.json'),
    path.join(evidence, 'integration/implementation-status.json'),
    path.join(root, 'assets/characters/pikachu/frames.json'),
  ];
  const bytes = inputs.map(file => readFileSync(file));
  const [inventory, implementation, frames] = bytes.map(value => JSON.parse(value));
  const actions = inventory.actions.map(action => ({
    id: action.id,
    implementation: action.implementation,
    visuals: action.visuals,
    runtime: action.runtime,
    remainingGap: action.remaining_gap,
    fidelityLimits: action.fidelity_limits,
    progress: action.progress ?? null,
  }));
  const annotated = actions.filter(action => action.progress !== null);
  const count = (field, value) => annotated.filter(action => action.progress[field] === value).length;
  const complete = annotated.filter(action => action.progress.complete === true &&
    action.progress.implementation === 'implemented' &&
    action.progress.visuals === 'accepted' && action.progress.runtime === 'verified' &&
    Array.isArray(action.progress.required_gaps) && action.progress.required_gaps.length === 0).length;
  const animations = Object.values(frames.animations);
  return {
    revision: createHash('sha256').update(Buffer.concat(bytes)).digest('hex'),
    updatedAt: new Date(Math.max(...inputs.map(file => statSync(file).mtimeMs))).toISOString(),
    total: actions.length,
    reconciled: annotated.length,
    complete,
    counts: {
      implemented: count('implementation', 'implemented'),
      accepted: count('visuals', 'accepted'),
      verified: count('runtime', 'verified'),
    },
    art: {
      sheets: animations.length,
      cells: animations.reduce((sum, animation) => sum + animation.frameCount, 0),
    },
    build: implementation.productionBuild ? {
      name: implementation.productionBuild.bundle,
      url: implementation.productionBuild.url,
      sheets: implementation.productionBuild.pikachuStrips,
      cells: implementation.productionBuild.pikachuCells,
    } : null,
    actions,
  };
}

export function pikachuProgressPlugin(root) {
  return {
    name: 'pikachu-live-progress',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (pathname !== '/pikachu-progress.json') return next();
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        try {
          response.end(JSON.stringify(readPikachuProgress(root)));
        } catch {
          // A writer may briefly replace a JSON file; the browser retries and
          // keeps its last successful snapshot rather than displaying zero.
          response.statusCode = 503;
          response.end(JSON.stringify({ error: 'Progress is being updated. Retry shortly.' }));
        }
      });
    },
  };
}
