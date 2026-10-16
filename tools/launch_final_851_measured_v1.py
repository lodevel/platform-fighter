"""Stagger8 measured workers then12 only with actual memory reserve."""
import subprocess,os,time,json,sqlite3
from pathlib import Path
D=Path('docs/review/2026-10-12/link-character/rework/art/final-actor-851-physical-fit-v1')
env=os.environ.copy();env.update({k:'1'for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS']});children=[];start=time.monotonic();queue=json.load(open(D/'queue.json'))
def available():return int(next(l.split()[1]for l in Path('/proc/meminfo').read_text().splitlines()if l.startswith('MemAvailable:')))
def launch():
 i=len(children);log=open(D/f'worker-{i:02}.log','w');p=subprocess.Popen(['python3','tools/final_actor_corpus_fit_v1.py',str(i)],env=env,stdout=log,stderr=subprocess.STDOUT);children.append((p,log));print('worker',i,'pid',p.pid,'MemAvailableKiB',available(),flush=True)
for i in range(8):launch();time.sleep(.5)
samples=[];next_fill=8
while any(p.poll()is None for p,f in children):
 rows=[]
 for i,(p,f)in enumerate(children):
  if p.poll()is not None:continue
  try:status=Path(f'/proc/{p.pid}/status').read_text();rows.append({'worker':i,'pid':p.pid,**{l.split(':')[0]:int(l.split()[1])for l in status.splitlines()if l.startswith(('VmRSS:','VmHWM:'))}})
  except FileNotFoundError:pass
 db=sqlite3.connect(queue['database']);counts=dict(db.execute('SELECT state,COUNT(*) FROM jobs GROUP BY state'));db.close();aggregate=sum(r['VmRSS']for r in rows);sample={'seconds':time.monotonic()-start,'MemAvailableKiB':available(),'aggregateWorkerRssKiB':aggregate,'workerCount':len(children),'live':rows,'counts':counts};samples.append(sample)
 # Worst measured new-worker transient708MiB plus2GiB available reserve.
 if len(children)<12 and sample['seconds']>25 and counts.get('DONE',0)>=14 and sample['MemAvailableKiB']>3*1024*1024:
  launch();time.sleep(1)
 path=D/'live-capacity-samples.json';pending=path.with_suffix('.pending');pending.write_text(json.dumps({'state':'MEASURED_DYNAMIC_V6_PRIVATE_CORPUS_RUNNING','affinityThreads':len(os.sched_getaffinity(0)),'samples':samples},indent=1)+'\n');pending.replace(path)
 time.sleep(2)
results=[{'worker':i,'pid':p.pid,'exitCode':p.returncode}for i,(p,f)in enumerate(children)]
for p,f in children:f.close()
(D/'launcher-terminal.json').write_text(json.dumps({'results':results,'seconds':time.monotonic()-start},indent=2)+'\n')
raise SystemExit(1 if any(r['exitCode']for r in results)else 0)
