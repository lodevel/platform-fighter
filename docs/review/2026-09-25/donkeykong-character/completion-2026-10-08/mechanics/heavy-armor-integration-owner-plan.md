Prepared patch plan; production unchanged during APP9 qualification.

Mechanics owns the unused armor helper/tests and DK source producers. Apply the
expanded helper draft only after the coordinator releases the hold. Its inputs
are modified raw reference KB, nativeCollisionAttribute and nativeForceReaction.
Known normal/elec/rush/bury requires explicit false; true selects forced launch;
unknown stays unsupported. Sleep and sleep_ex are known launch exceptions.
KB*.4 is a threshold proxy, not a recovered native reaction function.

For DK, prepare a compiled metadata leaf keyed by native motion/frame/ID from
the pinned complete scripts, then import it in dkSourceHits. This adds attribute
and force metadata to all 125 existing source regions without rewriting the
numeric table, source timings, geometry or sprite assets. The read-only ledger
matches all 125 keys across 31 motions. There are no native force setters in
those supported DK motion bodies. Explicit false is a supported ordinary source
packet interpretation; retain the missing engine initialization implementation
as a provenance limit. Unknown source keys must never default to normal/false.

Runtime owns transport and Character. Add optional nativeCollisionAttribute
and nativeForceReaction to AttackMove, AttackHitWindow, AttackCollisionHit,
HitboxPlugin and HitInfo. Parse and serialize them through existing shared
interaction parsing, nested windows/regions, specials and Lab/factory paths.
Preserve boolean false and field absence distinctly. Allow unknown native
attribute identifiers to round-trip; the classifier owns domain rejection.
Resolve window metadata without turning undefined force into false. On a
selected regional hit, use that region's metadata as authoritative: an omitted
field must not inherit a parent normal/false value from another region.
spawnHitbox and HitboxDamageHandler must carry the selected metadata to HitInfo.
Dynamic paired art capsule substitution must continue changing geometry alone.

No Pikachu assets or numeric data need change. Its existing immutable 145
records already contain attributes. A narrow producer change in
pikachuSourceMoves can pass row.attribute and a separately reviewed force ledger
into collisionHits. Supported ordinary records and any exceptional record must
be keyed by motion/native frame/ID, never by electricCollision. Existing data
contains Final2/FinalAir2: native10 ID1 has an explicit force setter, while
native0 ID0 does not. Treat per-ID setters separately; do not mark the entire
motion forced or default all electric records false. These Final actions are
not promoted to supported fighter routes by this metadata work.

Pikachu special contacts bypass pikachuSourceHits. Runtime's baseContact in
pikachuSpecialRuntime also needs metadata from the pinned ordinary special
packet/domain: Skull Bash normal, Quick Attack and Jolt/Thunder electric. This
is metadata-only code and preserves all existing source numbers, phase clocks,
receiving geometry and projectile behavior. No inference from the current
electric hitlag boolean is permitted. Generated pikachuSpecialContactData and
pikachuAttackData, frames.json and image assets remain untouched.

Character previews damage and KB after protection/shield guards, before
clearDonkeyKongItemAction and other destructive hit resets. Use prospective
post-hit percent, the existing rage/stale/weight/launch modifiers once, and
raw reference KB before trip, gravity boost, DI and all hitstun transforms.
Native bury requires the primary weight100 special query; at posthit100 the
pinned Headbutt gives80.8KB, while ordinary DK126 produces76.93451327433628 and
would wrongly resist. Resisted bury must return before burial creation.
SourceCarryActive requires actual held SuperLift state, no pickup/throw action,
and no incompatible pending launch/capture. Preserve damage and non-launch
hitlag once, carry phase/facing/resources and velocity restoration. No pending
launch means no SDI/ASDI in the existing frozen path. Legacy missing-reference
or unknown-domain hits follow the existing authored damage path explicitly.

Character must return actual resolved reactionResisted metadata plus a
per-hit unsolicited heavyItemDrop signal for a boundary, forced or sleep
launch. This must be the result of the classifier, never a pre-hit held-item
boolean. Direct applyHit diagnostic calls need the same classifier; detailed
application transports the resulting signal without guessing from zero KB.

Root owns Scene/Inventory and item metadata producers. A resisted flesh hit
must be confirmed once, registered to stale queue and damage statistics once,
and freeze the direct attacker once. Keep detached projectile owners free.
If reactionResisted is exposed on outcome landed, preserve existing confirmed
landed accounting; if a distinct armor outcome is used, explicitly extend
every consumer, since current armored outcome is excluded from confirmation.
For launch, drop the actual pre-hit heavy inventory object at native angle90/
speed0, detach/socket-sync once, then preserve the ordinary queued launch.
Use actual entity identity/reset generation to prevent dropping a replacement
item. Do not synthesize a pending throw request or reuse request-matched release
events for this unsolicited damage drop.

Crate nativeItemThrowHit currently has no general attribute/force metadata.
Root can extend NativeItemThrowProfile and its HitInfo producer without changing
six authored weapons. Native Throw explicitly names normal; ATTACK_FP flags
have unmapped semantics, so retain force unknown until the relevant mapping or
a separately declared ordinary source-packet adapter is established. Born fire
and wind remain unsupported contexts; do not quietly mark them non-applicable.

Scheduled verification: pure10 prepared cases; schema round-trips with false,
true and unknown at move/window/region levels; source-producer per-ID attr and
force comparisons; real Character carry retention, electric hitlag, weak/boundary
bury, sleep/forced launch and legacy fallback; actual Scene sensor confirmation,
stale/stat/ownership/drop exactly once; unchanged Pikachu numbers/assets and its
ordinary hit/charge regressions. Tests and runtime acceptance remain pending.
