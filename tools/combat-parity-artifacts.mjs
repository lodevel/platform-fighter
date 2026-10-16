import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { readBuildIdentity } from '../scripts/buildIdentity.ts';

// Run with Node20 --import tsx after the final production build.
const root = process.cwd();
const html = await readFile('dist/index.html', 'utf8');
const asset = html.match(/src="[^"]*\/assets\/(index-[^"]+\.js)"/)?.[1];
assert.ok(asset, 'Production entry must be present');
const bundlePath = resolve('dist/assets', asset);
const bundle = await readFile(bundlePath, 'utf8');
const expectedIdentity = readBuildIdentity(root);
assert.ok(bundle.includes(expectedIdentity), 'Build identity must match current runtime and authored data');
const map = JSON.parse(await readFile(`${bundlePath}.map`, 'utf8'));
const checked = [];
for (let index = 0; index < map.sources.length; index++) {
  const sourcePath = resolve(dirname(bundlePath), map.sources[index]);
  const local = relative(root, sourcePath).replaceAll('\\', '/');
  if (!local.startsWith('src/') || local === 'src/engine/buildIdentity.ts') continue;
  const current = await readFile(sourcePath, 'utf8');
  assert.equal(map.sourcesContent[index].replaceAll('\r\n', '\n'), current.replaceAll('\r\n', '\n'),
    `${local}: production source map differs from current source`);
  checked.push(local);
}
assert.ok(checked.includes('src/characters/Character.ts'));
assert.ok(checked.includes('src/characters/referenceSdi.ts'));
assert.ok(checked.includes('src/scenes/MatchScene.ts'));
const result = { artifact: asset, buildIdentity: expectedIdentity, matchingSourceCount: checked.length,
  matchingSources: checked.sort() };
await writeFile('docs/review/2026-09-22/combat-parity/artifact-verification.json', JSON.stringify(result, null, 2) + '\n');
console.log(`${asset}: current build identity and ${checked.length} runtime source-map entries match`);
