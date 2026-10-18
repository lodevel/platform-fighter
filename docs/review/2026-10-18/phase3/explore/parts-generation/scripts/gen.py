"""Run masked img2img jobs (the recipe of rework-2026-10-10/art/dk-run-job.py) from a jobs JSON list.
Each job: {key, seed_png, guide_png, mask_png, prompt, seed, denoise, strength, out}. Records seconds per job."""
import json, sys, time, uuid, urllib.request
from pathlib import Path
S = 'http://127.0.0.1:8188'
NEG = json.loads(Path('/home/lombet/Workspace/platform-fighter/docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/art/fighter.json').read_text())['negative']
def call(route, data=None, headers=None):
    return urllib.request.urlopen(urllib.request.Request(S + route, data=data, headers=headers or {}), timeout=60).read()
def upload(local, remote):
    b = Path(local).read_bytes(); bd = uuid.uuid4().hex
    body = (f'--{bd}\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput\r\n--{bd}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n'
            f'--{bd}\r\nContent-Disposition: form-data; name="image"; filename="{remote}"\r\nContent-Type: image/png\r\n\r\n').encode() + b + f'\r\n--{bd}--\r\n'.encode()
    call('/upload/image', body, {'Content-Type': f'multipart/form-data; boundary={bd}'})
def graph(j, f):
    neg = NEG + (', ' + j['negative_extra'] if j.get('negative_extra') else '')
    return {
     '1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'z_image_turbo_int8_convrot.safetensors', 'weight_dtype': 'default'}},
     '2': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'qwen_3_4b_fp8_mixed.safetensors', 'type': 'lumina2'}},
     '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'ae.safetensors'}},
     '4': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['2', 0], 'text': j['prompt']}},
     '5': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['2', 0], 'text': neg}},
     '7': {'class_type': 'KSampler', 'inputs': {'model': ['12', 0], 'seed': j['seed'], 'steps': 8, 'cfg': 1.0, 'sampler_name': 'euler',
           'scheduler': 'simple', 'positive': ['4', 0], 'negative': ['5', 0], 'latent_image': ['18', 0], 'denoise': j['denoise']}},
     '8': {'class_type': 'VAEDecode', 'inputs': {'samples': ['7', 0], 'vae': ['3', 0]}},
     '9': {'class_type': 'SaveImage', 'inputs': {'images': ['19', 0], 'filename_prefix': 'pf-dkparts-' + j['key']}},
     '10': {'class_type': 'LoadImage', 'inputs': {'image': f['guide']}},
     '11': {'class_type': 'ModelPatchLoader', 'inputs': {'name': 'Z-Image-Turbo-Fun-Controlnet-Union.safetensors'}},
     '12': {'class_type': 'ZImageFunControlnet', 'inputs': {'model': ['1', 0], 'model_patch': ['11', 0], 'vae': ['3', 0], 'image': ['10', 0], 'strength': j['strength']}},
     '13': {'class_type': 'LoadImage', 'inputs': {'image': f['seed']}},
     '15': {'class_type': 'VAEEncode', 'inputs': {'pixels': ['13', 0], 'vae': ['3', 0]}},
     '16': {'class_type': 'LoadImage', 'inputs': {'image': f['mask']}},
     '17': {'class_type': 'ImageToMask', 'inputs': {'image': ['16', 0], 'channel': 'red'}},
     '18': {'class_type': 'SetLatentNoiseMask', 'inputs': {'samples': ['15', 0], 'mask': ['17', 0]}},
     '19': {'class_type': 'ImageCompositeMasked', 'inputs': {'destination': ['13', 0], 'source': ['8', 0], 'x': 0, 'y': 0, 'resize_source': False, 'mask': ['17', 0]}},
    }
def run(j):
    if Path(j['out']).exists():
        print('skip', j['key']); return
    f = {k: f"pf-dkparts-{j['key']}-{k}.png" for k in ('seed', 'guide', 'mask')}
    for k in f: upload(j[k + '_png'], f[k])
    t = time.time()
    pid = json.loads(call('/prompt', json.dumps({'prompt': graph(j, f)}).encode(), {'Content-Type': 'application/json'}))['prompt_id']
    while True:
        h = json.loads(call('/history/' + pid)).get(pid)
        if h and h.get('status', {}).get('completed'):
            break
        if h and h.get('status', {}).get('status_str') == 'error':
            raise SystemExit('job failed ' + j['key'] + json.dumps(h['status'])[:2000])
        time.sleep(2)
    img = h['outputs']['9']['images'][0]
    Path(j['out']).parent.mkdir(parents=True, exist_ok=True)
    Path(j['out']).write_bytes(call('/view?' + urllib.parse.urlencode(img)))
    dt = time.time() - t
    Path(j['out'] + '.json').write_text(json.dumps({**j, 'seconds': round(dt, 1), 'negative': NEG}, indent=1))
    print(j['key'], round(dt, 1), 's', flush=True)
import urllib.parse
for j in json.loads(Path(sys.argv[1]).read_text()):
    run(j)
