# A1: DK output regression

`tools/dk-native-hit-positions.py` (deleted) and `tools/native-hit-positions.py --fighter dk` were run on the same 22 cases (`dk-baseline/cases.txt`: every DK ground and aerial normal, the specials with bone-attached hitboxes, getups and the ledge attack, grab scripts with no ATTACK rows). `dk-baseline/*.json` is the old script's output; every new output compared equal with `cmp` (byte-identical, 22 of 22).
