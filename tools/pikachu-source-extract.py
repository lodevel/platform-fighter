#!/usr/bin/env python3
"""Extract lossless attack arguments and motion-clock events from pinned captures.

Finite literal loops are expanded. This is a capture reader, not a game interpreter:
conditional code is retained explicitly; native status-dependent arithmetic is
never invented. Script frames remain motion frames, independently of UFD timing.
"""
import hashlib, json, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/review/2026-10-06/pikachu-character/sources'
ATTACK_KEYS = ['id','part','bone','damage','angle','kbg','fkb','bkb','size','x','y','z','x2','y2','z2','hitlag','sdi','setoff','lr_check','set_weight','shield_damage','trip','rehit','reflectable','absorbable','flinchless','disable_hitlag','direct','situation','category','collision_part','friendly_fire','attribute','sound_level','sound_attribute','region']
ABS_KEYS = ['kind','id','damage','angle','kbg','fkb','bkb','hitlag','sdi','lr_check','unknown_10','unknown_11','attribute','sound_level','sound_attribute','region']

def split_args(text):
    out=[]; start=0; depth=0; quoted=False; escaped=False
    for i,ch in enumerate(text):
        if ch=='"' and not escaped: quoted=not quoted
        if not quoted:
            if ch=='(': depth+=1
            if ch==')': depth-=1
            if ch==',' and depth==0: out.append(text[start:i].strip()); start=i+1
        escaped=ch=='\\' and not escaped
    out.append(text[start:].strip())
    return out

def atom(s):
    if s=='None': return None
    if s in ['true','false']: return s=='true'
    m=re.fullmatch(r'(?:Some\(([-\d.]+)\)|([-\d.]+))',s)
    if m: return float(m[1] or m[2]) if '.' in (m[1] or m[2]) else int(m[1] or m[2])
    m=re.fullmatch(r'Hash40::new\("([^"]+)"\)',s)
    return m[1] if m else s.lstrip('*')

def expand(lines, loops=()):
    out=[]; i=0
    while i<len(lines):
        line_no,line=lines[i]
        m=re.match(r'\s*for _ in (\d+)\.\.(\d+) \{',line)
        if m:
            depth=line.count('{')-line.count('}'); j=i+1
            while j<len(lines):
                depth+=lines[j][1].count('{')-lines[j][1].count('}')
                if depth==0: break
                j+=1
            if j==len(lines): raise ValueError(f'Unclosed loop at line {line_no}')
            a,b=map(int,m.groups())
            if b-a>1000: raise ValueError(f'Unbounded loop at line {line_no}')
            for n in range(a,b): out+=expand(lines[i+1:j],loops+({'source_line':line_no,'iteration':n,'count':b-a},))
            i=j+1
        else: out.append((line_no,line,loops)); i+=1
    return out

verified=json.loads((OUT/'verified.json').read_text())
expected={r['path']:r['sha256'] for r in verified['files']}
motions={}; inventory=[]
for path in sorted((OUT/'scripts').glob('*/*.txt')):
    raw=path.read_text(); rel=str(path.relative_to(ROOT)); sha=hashlib.sha256(path.read_bytes()).hexdigest()
    assert expected.get(rel)==sha, f'Unverified capture: {rel}'
    functions=[]
    for match in re.finditer(r'unsafe extern "C" fn (game_\w+)\([^\n]+\{',raw):
        depth=1; end=match.end()
        while depth and end<len(raw):
            depth+=(raw[end]=='{')-(raw[end]=='}'); end+=1
        prefix=raw[:match.end()].count('\n')+1
        lines=[(prefix+i,line) for i,line in enumerate(raw[match.end():end-1].splitlines())]
        frame=0; events=[]; attacks=[]; absolutes=[]; conditions=[]
        for line_no,line,loops in expand(lines):
            s=line.strip()
            if not s: continue
            for _ in range(len(s)-len(s.lstrip('}'))):
                if conditions: conditions.pop()
            if s.endswith('{'):
                conditions.append(s[:-1].strip())
                continue
            clock=re.search(r'(frame|wait)\(agent.lua_state_agent, ([\d.]+)\)',s)
            if clock: frame=float(clock[2]) if clock[1]=='frame' else frame+float(clock[2]); continue
            if s in ['}','};']: continue
            context=[x for x in conditions if x and x!='if macros::is_excute(agent)']
            event={'frame':frame,'source_line':line_no,'raw':s,'loop_iterations':list(loops),'conditions':context}
            m=re.match(r'macros::(ATTACK|ATTACK_ABS)\(agent, (.*)\);',s)
            if m:
                args=split_args(m[2]); keys=ATTACK_KEYS if m[1]=='ATTACK' else ABS_KEYS
                assert len(args)==len(keys),(rel,line_no,len(args),len(keys))
                record={**event,**dict(zip(keys,map(atom,args))),'raw_args':args,'end_frame':None}
                event['type']=m[1]; event['record_index']=len(attacks if m[1]=='ATTACK' else absolutes)
                (attacks if m[1]=='ATTACK' else absolutes).append(record)
            elif 'AttackModule::clear_all(' in s: event['type']='clear_all'
            elif 'AttackModule::clear(' in s:
                event['type']='clear_id'; event['id']=int(re.search(r'agent.module_accessor, (\d+)',s)[1])
            elif 'AttackModule::set_size(' in s:
                event['type']='set_size'; a=split_args(s[s.index('(')+1:s.rindex(')')]); event['id']=atom(a[1]); event['size']=atom(a[2])
            elif 'macros::ATK_HIT_ABS(' in s: event['type']='apply_absolute'
            elif 'macros::FT_MOTION_RATE(' in s: event['type']='motion_rate'; event['rate']=atom(split_args(s[s.index('(')+1:s.rindex(')')])[1])
            else: event['type']='command'
            events.append(event)
        # An interval ends on explicit clear or replacement. Status exits remain unknown.
        for ai,a in enumerate(attacks):
            seen=False
            for e in events:
                if e.get('type')=='ATTACK' and e.get('record_index')==ai: seen=True; continue
                if not seen: continue
                if e['type']=='clear_all' or (e['type'] in ['clear_id','ATTACK'] and (e.get('id') if e['type']=='clear_id' else attacks[e['record_index']]['id'])==a['id']):
                    a['end_frame']=e['frame']; a['end_reason']=e['type']; break
        functions.append({'name':match[1],'attacks':attacks,'absolutes':absolutes,'events':events})
    key=path.parent.name+'/'+path.stem
    motions[key]={'motion':path.stem,'object':path.parent.name,'path':rel,'sha256':sha,'functions':functions}
    inventory.append({'motion':path.stem,'object':path.parent.name,'path':rel,'sha256':sha,'attack_records':sum(len(f['attacks']) for f in functions),'absolute_records':sum(len(f['absolutes']) for f in functions),'game_functions':[f['name'] for f in functions]})
payload={'script_revision':'59004685238a3f6f93bae905d3a4e079701c40b4','clock':'script-motion-frames; UFD gameplay timing is separate','condition_policy':'non-is_execute conditions retained; not evaluated','motions':motions}
(OUT/'native-attacks.json').write_text(json.dumps(payload,indent=2)+'\n')
(OUT/'script-inventory.json').write_text(json.dumps(inventory,indent=2)+'\n')
print(f'Extracted {sum(x["attack_records"] for x in inventory)} ATTACK and {sum(x["absolute_records"] for x in inventory)} ATTACK_ABS records across {len(inventory)} motions.')
