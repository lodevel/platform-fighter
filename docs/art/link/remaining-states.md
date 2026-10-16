# Link: remaining animation states

Use the identity, canvas and supervision contract in
[the handoff](generation-handoff.md). These are ordered drawing briefs, not
verified fixed-duration animations. Resolve each source timing and runtime
branch before scheduling exact pose holds. No images have been generated.

| Family | Ordered drawing instructions | Timing and integration condition |
| --- | --- | --- |
| Idle | Neutral guard; restrained inhale/weight shift; neutral return; exhale. | Calm four-key loop; do not resize one drawing to simulate breathing. |
| Walk / dash / run | Contact; weight acceptance; passing leg; push-off; opposite contact; return. Dash starts with a committed lean. | Six-eight proposed keys per distinct cycle; simulation supplies travel. Confirm clip routes before producing separate sets. |
| Jump / fall / land | Compression; extension; airborne tuck; apex balance; descending reach; landing absorption; guard. | Use state-driven poses, including actual jump-squat and landing commitment. |
| Crouch / shield / hurt / grabbed | Low passive guard; braced shield; flinch/recoil; held-by-opponent pose. | Static holds can use one drawing; shield bubble stays an engine effect. |
| Spot dodge / rolls | Evade from stance; compressed/rotated midpoint; recover. Separate forward/back motions. | State controls movement and intangibility; the image does not decide immunity. |
| Neutral / directional air dodge | Airborne brace; evasion midpoint; vulnerable recovery. | Include diagonal checks. Do not bake root travel into art or turn the fighter solely from travel direction. |
| Ledge options | Handhold/hang; drop, climb, jump, roll or attack; recovery. | Attach the gripping hand to the live ledge anchor. Each exit is a separate branch. |
| Getup / trip | Prone/supine preparation; stand/roll or attack; guard. | Confirm available variants, commitment and contact before scheduling. |
| Bow | Reach for bow; draw; charge hold; release; recover. Flying arrow separately. | Charge duration varies. Arrow/item/double-arrow branches follow runtime events. |
| Boomerang | Windup; throw; follow-through; recover; conditional catch. Separate spinning projectile. | Release and catch differ. Angle/smash-throw/catch mechanics need further verification. |
| Ground Spin | Grounded charge; stable hold; rotational sword keys; finish; recover. | Separate from airborne recovery; current contact geometry is approximate. |
| Air Spin | Lift; rotating rises; intermediate passes; finisher; helpless fall; landing. | Map to all contact rungs/gaps. Simulation supplies vertical movement. |
| Remote Bomb | Pull; release/carry grip; throw anticipation; toss; remote activation; recovery. | Pull, throw and detonate are distinct actions. Held/flying/resting bomb and explosion are separate entities/effects. |
| Grab / pummel | Reach; extension; miss retract; hold; pummel windup/impact/retract. | Current project grab timing differs from UFD; source-audit before assigning final holds. |
| Four throws | Maintain grip; directional load; release; follow-through; recover, separately for each direction. | Throw timing still needs its separate audit. Victim follows a live anchor; do not bake an opponent into Link's sprite. |
| Down-air rebound | Plunge reaction; upward bounce; conditional return contact; airborne recovery. | Branch only after successful runtime contact. Never append unconditionally. |
| Pickups | Bat/hammer load and swing; sword/spear grip and strike; ray-gun aim/recoil; bomb carry/toss. | Check current item inventory and body-clip support. Item damage/range stays in its own system. |
| Objects/effects | Arrow; spinning boomerang; bomb; explosion; conditional sword beam. | Give each its own dimensions/anchor and event timing, not the body's 512px canvas by default. Check visible position/contact/cleanup together. |

Current special sheets have three poses; ground/air spin share one route and
bomb branches share another. Dodges reuse compressed shield artwork; ledge
states reuse jump artwork. Replacing them requires state-specific routing.

The normal-attack batch does not complete this backlog. An art request does not
authorize unrelated mechanics changes. Continue separately authorized gameplay
work while images are deferred.
