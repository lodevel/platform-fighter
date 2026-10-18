#!/bin/bash
# usage: gpu_session.sh JOBS.json — takes the GPU lock, waits for free GPU memory, starts ComfyUI, runs the jobs,
# stops ComfyUI (by its own PID) before releasing the lock.
D=$(cd "$(dirname "$0")" && pwd)
exec flock /home/lombet/Workspace/platform-fighter/.tmp/dk-heavy.lock bash -c '
D="$0"; JOBS="$1"
for i in $(seq 1 180); do u=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1); [ "$u" -lt 1500 ] && break; sleep 5; done
echo gpu used $u MiB $(date +%T)
cd ~/ComfyUI
.venv/bin/python main.py --listen 127.0.0.1 --port 8188 --disable-smart-memory > "$D/comfy.log" 2>&1 &
CP=$!
for i in $(seq 1 120); do curl -s -m 2 http://127.0.0.1:8188/system_stats > /dev/null && break; sleep 2; done
echo comfy up pid $CP $(date +%T)
python3 "$D/gen.py" "$JOBS"; rc=$?
kill $CP; wait $CP 2>/dev/null
kill -0 $CP 2>/dev/null && { sleep 5; kill -9 $CP; }
echo done rc=$rc $(date +%T)
' "$D" "$(realpath "$1")"
