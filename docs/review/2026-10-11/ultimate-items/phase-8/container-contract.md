# Phase 8 container interface

ItemDefinition.container carries ContainerSpec; kind distinguishes crate/barrel/capsule. Capsule uses throwing input class; Crate/Barrel heavy container class.

ItemEntity.getContainerState exposes HP, resolved and optional rolling velocity/angle. damageContainer accepts positive real damage and returns true at zero HP; runtime deduplicates attacks. resolveContainerBreak(frame, position, draws) returns contents or explosion once and legally transitions held/grounded/falling containers to broken with no holder. Caller supplies seeded item-container draws and one contents definition; duplicate the same definition and Food variant for each copy.

Draws: {explosionRoll, countRoll, contentsType:string|null, throwAction?:ItemAction}. Outcome: {kind:explosion, explosion:ItemExplosionSpec} or {kind:contents, type:string|null, count:number}.

eligibleContainerContents(spec, enabled) respects Item Switch catalog, excludes heavy, allows Capsule in Crate/Barrel and excludes self-Capsule as authored recursion restriction. Empty eligible catalog releases zero on nonexplosive roll; source increased empty-switch dud probability unresolved.

containerBreaksOnImpact(spec, fighter|terrain) opens Crate/Capsule on fighter/terrain; Barrel terrain starts rolling, fighter contact opens. Crate unconditional terrain opening authored. startContainerRoll(vx) takes actual world speed; stepContainerRoll applies native cap/friction plus authored stop and rotation; runtime owns support/slope/falling/contact. setContainerRolling(null) ends rolling; isPickable rejects actively rolling grounded Barrel (Brawl-scoped stopped/pickable adaptation). No extra roll timeout beyond authored item TTL.

Exploding Capsule contact uses one action-specific blast packet rather than normal contact plus blast. Attacked/unsupported contexts use separately labelled native22. Downward capsule owner immunity sourced Ultimate; otherwise include owner. Generic Wiki Explosion throw17 remains unresolved anomaly, not global value. Barrel count1 is authored after missing retained native count data, not sourced.

No tests, typecheck, build or browser checks run; implementation has no match acceptance claim.

Carrier/capsule damage lookup: heavy carry keeps Crate/Barrel native throwProfile packets and common heavy ItemAction release velocities; Capsule is a light throwing class and uses ordinary itemActions. nativeItemThrow.thrownItemHit reads definition.thrownHit.damageByAction for the Capsule nonexplosive explicit Wiki rows, falling back to native base8+speed formula for absent/N/A contexts. containerBreakOutcome reads definition.container.explosionDamageByAction for exploded Capsule actions, falling back to separate native22 Born packet. Explosive packet is emitted once; runtime must not also apply the nonexplosive packet. Downward owner immunity uses Capsule definition.container.downThrowOwnerImmune and the actual retained throwAction.

Crate/Barrel nonheavy loot filtering is explicitly authored supported-catalog eligibility; source specifically excludes heavy contents only for Capsule. All visual descriptors now match the art-owner contract: Crate80x75, Barrel71x79, Capsule24x36, bottom-root. Crate now consumes native item_common vertical outer limit2.4 as well as horizontal2.4; Barrel3 and Capsule4 native vertical caps included too.
