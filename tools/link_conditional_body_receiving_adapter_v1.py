"""Exact twelve source-audited conditional body receiving resources only.

This adapter keeps strict default evaluation, all matched channels and matrix
helper/scale guards. No missing native bone is fabricated or remapped.
"""
from pathlib import Path
import json
POLICY=Path('docs/review/2026-10-12/link-character/rework/source-contracts/conditional-recipient-track-binding-policy-v1.json')
EXPECTED_POLICY_SHA='9ac8510267e6f9cb6988ce799cd09fa50554f3924a2a4f2431b8e92fc42a4a2b'
RESOURCES=frozenset('e01thrown'+family+direction+'.nuanmb' for family in ['dx','big','girl'] for direction in ['f','b','hi','lw'])
def install_on_guide(guide):
 import hashlib
 if hashlib.sha256(POLICY.read_bytes()).hexdigest()!=EXPECTED_POLICY_SHA:raise ValueError('Frozen exact twelve source policy changed')
 rows=json.loads(POLICY.read_text())['resources']
 if set(rows)!=RESOURCES:raise ValueError('Conditional source identity universe changed')
 original=guide.LinkNativePose
 def audited(motion_path,track_binding_policy=None):
  path=Path(motion_path)
  if path.name not in RESOURCES:return original(path,track_binding_policy=track_binding_policy)
  if track_binding_policy is not None:raise ValueError('Do not stack source binding policies')
  if rows[path.name]['role']!='BODY_RECEIVING_TEMPLATE':raise ValueError('Standalone hand/shared unqualified resource forbidden')
  return original(path,track_binding_policy=POLICY)
 guide.LinkNativePose=audited
