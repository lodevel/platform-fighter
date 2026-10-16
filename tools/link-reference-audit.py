"""Read vanilla Link script declarations; no local runtime mutations."""
import json
import urllib.request
import concurrent.futures
import re

def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "platform-fighter-reference-audit"})).read().decode()

SHA = "59004685238a3f6f93bae905d3a4e079701c40b4"
SCRIPTS = ["Attack11", "Attack12", "Attack13", "AttackS3", "AttackHi3", "AttackLw3", "AttackDash", "AttackS4", "AttackS4S2", "AttackHi4", "AttackLw4", "AttackAirN", "AttackAirF", "AttackAirB", "AttackAirHi", "AttackAirLw"]
def read_script(name):
    url = f"https://raw.githubusercontent.com/WuBoytH/SSBU-Dumped-Scripts/{SHA}/smashline/lua2cpp_link/link/{name}.txt"
    source = fetch(url)
    # Keep gameplay declarations only; effect/sound/expression sections follow.
    gameplay = source.split('\nunsafe extern "C" fn', 1)[0]
    return name, gameplay
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    for name, source in pool.map(read_script, SCRIPTS):
        print("\n" + name)
        for line in source.splitlines():
            if "macros::ATTACK(" in line:
                match = re.search(r'ATTACK\(agent, (\d+), (\d+), Hash40::new\("([^"]+)"\), ([^,]+), ([^,]+)', line)
                print("hit", match.groups() if match else "unparsed")
            elif any(marker in line for marker in ["frame(", "wait(", "clear", "on_flag", "off_flag", "MOTION_RATE"]):
                print(line.strip())

motion = fetch("https://raw.githubusercontent.com/WuBoytH/SSBU-Dumped-Motion-Lists/3f14a9d46b69eb9e7cd622bddde459192848580e/fighter/link/motion/body/c00/motion_list.yml")
print("\nMOTION LIST")
for match in re.finditer(r'^  (attack_[a-z0-9_]+):\s*\n((?:    .*\n)+)', motion, re.MULTILINE):
    print(match.group(1), " ".join(line.strip() for line in match.group(2).splitlines() if any(x in line for x in ["cancel_frame", "end_frame", "blend_frames"])) )
