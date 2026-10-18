"""Idle for the generated part set: no Ultimate idle recording exists, so this is a hand-keyed breathing loop
around the part author's idle pose (native a00wait1, .tmp/rig/donkeykong-parts/test-poses.json)."""
import json, sys
src, out = sys.argv[1], sys.argv[2]
p = json.load(open(src))['idle']; s = 0.4666667
variants = {'head_shout', 'head_grit', 'open_hand_near', 'open_hand_far'}
base = {b: {'angle': a} for b, a in p['angles'].items() if b not in variants and a}
base['torso'] = {**base.get('torso', {}), 'x': round(p['root'][0] * s, 2), 'y': round(p['root'][1] * s, 2)}
def breathe(d):
  k = json.loads(json.dumps(base))
  for bone, delta in d.items():
    for ch, v in delta.items(): k.setdefault(bone, {})[ch] = round(k.get(bone, {}).get(ch, 0) + v, 2)
  return k
inhale = {'torso': {'angle': 1.5, 'y': 1.0}, 'thigh_near': {'angle': -1.5}, 'thigh_far': {'angle': -1.5}, 'head': {'angle': 3},
          'upper_arm_near': {'angle': 3}, 'upper_arm_far': {'angle': -3}, 'tie': {'angle': 4}}
settle = {'torso': {'angle': -1.0, 'y': 0.5}, 'thigh_near': {'angle': 1.0}, 'thigh_far': {'angle': 1.0}, 'head': {'angle': -2},
          'upper_arm_near': {'angle': -2}, 'upper_arm_far': {'angle': 2}, 'tie': {'angle': -3}}
keys = [{'tick': 0, 'ease': 'smooth', 'bones': base}, {'tick': 35, 'ease': 'smooth', 'bones': breathe(inhale)},
        {'tick': 70, 'ease': 'smooth', 'bones': base}, {'tick': 105, 'ease': 'smooth', 'bones': breathe(settle)}]
json.dump({'actions': {'idle': {'after': 'loop', 'length': 140, 'keys': keys}}}, open(out, 'w'), indent=1)
