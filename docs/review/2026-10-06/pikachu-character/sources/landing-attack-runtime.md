# Automatic aerial landing contact consumer

Checked 2026-10-06. This scoped engine work is implemented and measured below.
Pikachu remains outside the roster; native pose transforms, accepted art and a
complete fighter match are not claimed.

`AerialMove.landingAttack` carries a nested grounded attack with its own regional
collision windows, animation and hurtbox modifiers. Its busy timeline must equal
the parent landing lag, and its cooldown is zero. Charge, combo, conditional
variant and special routes are rejected. The nested record is automatic and
does not occupy a selectable attack slot.

Character resolves real floor touchdown before input arbitration. Outside an
autocancel window it removes the airborne action/sensor, preserves that action's
captured facing and starts the nested timeline at elapsed0. All contact snapshots,
hurtbox phase selection and animation read that same timeline. Hitlag pauses
landing elapsed time and action recovery together. The landing record retires
before arbitration on the first free step, including the before-input item gate.
Damage/capture/reset cleanup interrupts it; ordinary land, autocancel or a new
motion replacing an old landing context does not replay the old route.

| Pikachu action | Captured native root contact | Prepared world projection | Gameplay contact/commitment |
| --- | --- | --- | --- |
| Back-air landing |top:(0,4,0), radius8; damage4; motion1–2 clear3|circle(0,5), radius40|elapsed0–1, clear2;18 committed landing steps|
| Down-air landing |top:(0,4,-6) to(0,4,6), radius4; damage4; motion1–2 clear3|capsule(-30,5) to(30,5), radius20|elapsed0–1, clear2;22 committed landing steps|

Root scale5 and root-below-body-centre25 remain authored conversions. The source
builder attaches these known root records automatically to their parent aerial.
Non-root airborne geometry still requires explicit reviewed pose projection.
The test projector puts airborne regions away from the contact probe; it does
not constitute an acquired native Pikachu pose.

Serialization preserves the nested attack, collision regions/windows, launch and
feel values, optional animation and hurtbox modifiers. Omitted animation remains
omitted. Restored saved fighters use the existing factory override path; no
manual registration of the landing action is needed. Lab numeric discovery exposes
nested geometry/timing/damage fields and saved edits survive restoration.

Validation outcomes:

- 13 new actual Matter floor/contact tests pass: both facings; hits and beyond-edge
  misses; first/last active/clear frames; one strike across geometry snapshots;
  delayed-contact hit/miss; exactly18/22 commitment; autocancel; hitlag freeze and
  resume; damage/reset interruption; new aerial replacing an old landing flag;
  JSON-save→factory→automatic landing contact/animation/hurtbox restoration.
- 37 existing real Matter aerial landing timeline tests pass unchanged. A full
  initial44-test landing-file run also found one unrelated stale Link ground-speed
  assertion (expected7.8, current profile7.67); its movement-only group is not
  included in the subsequent scoped timeline command.
- 8 landing/rehit transport tests pass, including malformed nested geometry/timing,
  Lab edits, legacy omission, regional rehit counts and explicit clock policy.
- Existing aerial schema142, serializer81, factory23 and timed throw serializer14
  tests pass. Source normal tests31 and normal Matter probes6 pass.
- Shared special landing25 and remote-bomb item gating15 tests pass with the
  nested landing exit and before-input item gate.
- Four actual Matter fair actor-clock tests pass in the separately owned
  `pikachuFairClock.physics.test.ts`; that clock is explicitly authored, while
  native timer counting during hit-stop remains unresolved.

Commands:

```
npx vitest run src/characters/Character.aerialLandingAttack.physics.test.ts src/characters/Character.landing.physics.test.ts -t 'automatic aerial landing contacts|real Matter aerial landing timeline'
npx vitest run src/characters/characterAerialLandingAttackSerializer.test.ts src/characters/aerialSchema.test.ts src/characters/characterSerializer.test.ts src/characters/characterFactory.test.ts src/characters/characterThrowHitsSerializer.test.ts
npx vitest run src/characters/Character.aerialLandingAttack.physics.test.ts src/characters/Character.specialLanding.physics.test.ts src/items/RemoteBombAdapter.physics.test.ts
npx vitest run src/characters/pikachuNormalMoves.test.ts src/characters/characterAerialLandingAttackSerializer.test.ts src/characters/pikachuFairClock.physics.test.ts src/characters/Character.aerialLandingAttack.physics.test.ts
npm run typecheck
```

Targets are stationary one-pixel probes; confirmed damage information is recorded
without target knockback. Floor contact is real Matter support, using injected
simulation input rather than physical keyboard/gamepad events. Animation assertions
prove shared frame selection, not accepted visible sprites. Production/browser
acceptance now passes38 scenarios on immutable `index-v5AbW1PH.js`, including
saved factory restoration, both-facing actual floor contact and eight landings
after the aerial finishes. See [landing-browser evidence](../landing-browser/README.md).
A prior production build attempt
was canceled at the coordinator's instruction to preserve the DK output; Vite
had already cleaned workspace `dist`. The coordinator subsequently restored the
accepted production artifact `index-CfNjrSwJ.js` and is handling the current
shared production build. This record does not claim that the canceled attempt
was successful or that the restored DK artifact verifies this landing consumer.
