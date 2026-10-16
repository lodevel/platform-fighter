"""Opt-in only to four previously source-reviewed receiving-template resources.

Default evaluator behavior stays strict. No unbound bone is created, remapped,
or used as a target; exact matching source channels and all matrix guards stay.
Hand-only overlays never enter this body rendering adapter.
"""
from pathlib import Path
import json

POLICY=Path('docs/review/2026-10-12/link-character/rework/source-contracts/trajectory-track-binding-policy.json')
RESOURCES=frozenset({'e01thrownb.nuanmb','e01thrownf.nuanmb','e01thrownhi.nuanmb','e01thrownlw.nuanmb'})

def install_on_guide(guide):
    original=guide.LinkNativePose
    def source_qualified_pose(motion_path,track_binding_policy=None):
        path=Path(motion_path)
        if path.name not in RESOURCES:
            return original(path,track_binding_policy=track_binding_policy)
        if track_binding_policy is not None:raise ValueError('Do not stack binding policies')
        row=json.loads(POLICY.read_text())['resources'][path.name]
        if row['role']!='BODY_RECEIVING_TEMPLATE' or set(row['allowedUnboundChannelNames'])!={'ClavicleC','LegC'}:
            raise ValueError('Audited receiving-template policy changed')
        # Constructor checks source/resource/skeleton/helper/mesh hashes and
        # exact unbound names before retaining all 24 real body channels.
        return original(path,track_binding_policy=POLICY)
    guide.LinkNativePose=source_qualified_pose
