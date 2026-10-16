#!/usr/bin/env python3
"""sync-manifest-sheets.py <fighter> — rewrite the fighter's `<fighter>Spritesheets`
block in src/assets/manifest.ts from assets/characters/<fighter>/frames.json so
the preload entries (frame counts, sheet list) always mirror the packed strips.
Every sheet in frames.json needs a `char<Fighter><Sheet>` key in ASSET_KEYS; the
script reports (and refuses) unknown sheets instead of guessing keys.
"""
import json, re, sys
fighter = sys.argv[1]
cap = fighter[:1].upper() + fighter[1:]
frames = json.load(open(f'assets/characters/{fighter}/frames.json'))
cell = frames['meta']['cellWidth']
src = open('src/assets/manifest.ts').read()
def key_for(sheet):
    parts = sheet.split('_')
    return f'char{cap}' + ''.join(p[:1].upper() + p[1:] for p in parts)
missing = [s for s in frames['animations'] if f'  {key_for(s)}:' not in src]
if missing:
    sys.exit(f'ASSET_KEYS is missing entries for: {missing} (expected {[key_for(s) for s in missing]})')
order = ['idle', 'run', 'jump', 'attack', 'crouch'] + sorted(s for s in frames['animations'] if s not in ('idle', 'run', 'jump', 'attack', 'crouch'))
lines = [f"  [ASSET_KEYS.{key_for(s)}, '{s}', {frames['animations'][s]['frameCount']}]," for s in order if s in frames['animations']]
block = f"const {fighter}Spritesheets: readonly SpritesheetAssetEntry[] = charSheetEntries('{fighter}', [\n" + "\n".join(lines) + f"\n], {'CHAR_FRAME_SIZE_HD' if cell == 256 else 'CHAR_FRAME_SIZE'});"
pattern = re.compile(rf"const {fighter}Spritesheets: readonly SpritesheetAssetEntry\[\] = charSheetEntries\('{fighter}', \[\n.*?\n\], CHAR_FRAME_SIZE(?:_HD)?\);", re.S)
if not pattern.search(src):
    sys.exit(f'could not find the {fighter}Spritesheets block')
open('src/assets/manifest.ts', 'w').write(pattern.sub(lambda m: block, src, count=1))
print(f'[sync-manifest] {fighter}: {len(lines)} sheets, cell {cell}px')
