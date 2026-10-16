# Special parameter acquisition follow-up

Initial follow-up checked 2026-10-06. A later acquisition on this date found a
different, explicitly Ultimate parameter table; see
[native-vl-sheet-contract.md](native-vl-sheet-contract.md). It supplies all44
prior status-read values while complete typed native PRC/patch metadata remains
missing. The investigation below records the earlier wiki-only lead boundary.
No runtime or production-bundle changes were made for this investigation.

Four technical SmashWiki pages provide 43 parameter descriptions. Their
revision IDs, captured API bytes, hashes and reported text are preserved in
[special-parameter-wiki-leads.json](special-parameter-wiki-leads.json).
Quick Attack's table first appears in revision 1688039, edited by DrakRoar on
2022-05-16. The current side/neutral/down-special revisions are
1687900/1699620/1707061. No raw Pikachu game-file capture, typed field export or
original extraction link was found through these pages or the editor's public
profile/talk trail. The matching GitHub username has no public repositories or
gists; the wiki/GitHub identity match is unconfirmed. These are secondary leads,
with patch and exact native field mapping unknown.

The independently acquired status scripts were inspected to separate literal
constants from missing parameter reads. All 226 capture hashes still match their
original manifest. The resulting [native-literal record](special-native-literals.json)
supplies five individually sourced constants:

| Native literal | Meaning and limit |
| --- | --- |
| Thunderjolt 24 | Ground/surface entity's attack-clear threshold in its motion clock. It does not establish lifetime 84 or observed 96. |
| Cloud 32 | Numerator of the bolt segment generation interval `abs(32 / param_cloud.speed_)`. The speed remains unknown. |
| Quick Attack 0.002666667 | Positive gravity-energy acceleration after the startup disable counter becomes negative. The counter initialization/delay remains unknown. |
| Quick Attack ±0.001 | Stored horizontal warp-speed threshold for selecting facing. It does not establish warp speed 11. |
| Skull Bash 0.5 | Boundary between normalized charge levels 1/2, with level 3 at 1. Charge-frame parameter remains unknown in the native capture. |

None of the wiki's reported 100/84 lifetimes, 105 cloud height, 300 maximum bolt
distance, 80 ground penetration, 17 self-detection size, or 0.66/0.016 recoil
values is independently established by a matching literal in these captures.
The jolt loops decrement an already initialized `INT_LIFE`; that numeric
initialization is absent. Thunder startup horizontal multipliers and recoil
speed/gravity are explicit parameter reads, whose values remain null.
An attack capsule radius cannot establish a separate self-contact detector.

The retained original Skull Bash charge measurement independently corroborates
80 charge frames, 20 flick bonus and 6.2–21.4 damage endpoints. Its patch remains
unknown, and it does not supply native motion parameters. Reported coded versus
observed jolt lifetime differences require state-clock review before use.
The `dengekidama/Regular/init.c` capture declares `Regular_fix_cam`; this alias
or dump defect remains visible instead of being treated as valid initialization.

The required next artifact is a versioned vanilla
`fighter/pikachu/param/vl.prc` or equivalent typed export, together with entity
construction/parameter evidence. No new native PRC number was promoted, and
the special numeric-parity gate remains missing.
