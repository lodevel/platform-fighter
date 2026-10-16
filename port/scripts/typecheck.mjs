// Typecheck the port and every shared game module it imports.
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false', '-p', '.'], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('port typecheck: ok');
