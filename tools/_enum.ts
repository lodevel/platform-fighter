import * as drv from './../src/characters/movesetAnimationDriver.ts';
const exp = Object.keys(drv);
console.log('exports:', exp.join(', '));
const fn = (drv as any).enumerateAllMovesetAnimationKeys;
if (typeof fn === 'function') {
  for (const arg of ['link', undefined]) {
    try {
      const out = fn(arg);
      const arr: string[] = Array.isArray(out) ? out : Object.keys(out ?? {});
      const moves = new Map<string, number>();
      for (const k of arr) { const m = String(k).split('.').slice(0, 2).join('.'); moves.set(m, (moves.get(m) || 0) + 1); }
      console.log(`\narg=${arg}: ${arr.length} keys`);
      for (const [m, c] of moves) console.log(`  ${m}: ${c}`);
      if (arr.length) break;
    } catch (e: any) { console.log(`arg=${arg} threw:`, e.message); }
  }
}
