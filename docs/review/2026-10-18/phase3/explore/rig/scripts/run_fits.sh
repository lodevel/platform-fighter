#!/bin/bash
# CPU only, niced: v2 jab, generated jab and generated smash in parallel (4 threads each).
cd /home/lombet/Workspace/platform-fighter
export CUDA_VISIBLE_DEVICES= RIG_THREADS=4
PY="nice -n 19 $HOME/ComfyUI/.venv/bin/python tools/rig-pose-fit.py"
rm -f /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/poses-v2-jab.json /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/poses-gen-jab.json /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/poses-gen-smash.json
$PY --package /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/pkg-v2-rest --action jab --ultimate assets/gen/dk-ufd/extracted/DonkeyKongJab1 --length 24 --after stop \
  --show head=rig/head,rig/head_open arm=rig/arm,rig/arm_ext,rig/arm_cross --z rig/arm_ext=2 --out /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/poses-v2-jab.json --images /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/fit-img-v2/jab > /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/f-v2-jab.log 2>&1 &
$PY --package /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/pkg-gen-rest --action jab --ultimate assets/gen/dk-ufd/extracted/DonkeyKongJab1 --length 24 --after stop \
  --show head=rig/head,rig/head_shout --offsets torso --out /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/poses-gen-jab.json --images /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/fit-img-gen/jab > /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/f-gen-jab.log 2>&1 &
$PY --package /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/pkg-gen-rest --action smash --ultimate assets/gen/dk-ufd/extracted/DonkeyKongFSmash --ultimate-scale 0.573 --canvas 900,400,330,370 \
  --ticks 0-53 --length 60 --after hold --show head=rig/head_shout,rig/head_grit fist_near=rig/open_hand_near fist_far=rig/open_hand_far \
  --offsets torso --out /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/poses-gen-smash.json --images /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/fit-img-gen/smash > /tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/rig/f-gen-smash.log 2>&1 &
wait
echo all-fits-done
