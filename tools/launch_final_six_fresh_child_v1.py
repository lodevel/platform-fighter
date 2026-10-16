"""Fresh small launcher avoids inherited direct-exec rusage high-water ambiguity."""
import subprocess,os,json,time
from pathlib import Path
D=Path('docs/review/2026-10-12/link-character/rework/art/final-actor-fit-six-pilots-v1');D.mkdir(exist_ok=True)
env=os.environ.copy();env.update({k:'1'for k in ['OPENBLAS_NUM_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS']})
p=subprocess.Popen(['python3','tools/final_actor_fit_six_pilots_v1.py'],env=env)
samples=[];start=time.monotonic()
while p.poll()is None:
 try:
  status=Path(f'/proc/{p.pid}/status').read_text();row={'seconds':time.monotonic()-start,'pid':p.pid,**{l.split(':')[0]:int(l.split()[1])for l in status.splitlines()if l.startswith(('VmRSS:','VmHWM:'))}};samples.append(row)
  (D/'live-process-memory.json').write_text(json.dumps({'childPid':p.pid,'samples':samples,'peakActualRssKiB':max(r['VmRSS']for r in samples),'peakActualHwmKiB':max(r['VmHWM']for r in samples)},indent=2)+'\n')
 except FileNotFoundError:pass
 time.sleep(.5)
raise SystemExit(p.returncode)
