# Input windows and gameplay responsiveness

The responsiveness report led to a concrete gap in `Character.tickAttack`: a queued offensive press was dispatched only once `canAttack()` became true, while authored jab and optional follow-up windows accepted only fresh button edges. A tap shortly before Link's jab opening could expire instead of advancing the string, even though it was inside the existing nine-step input buffer.

The shared attack driver now allows a live buffered attack to enter a jab window, and a buffered light/heavy attack to enter an authored optional follow-up window. It checks the window after advancing the move clock, consumes the queued press on successful transition, and retains grounded, landing and action-lock restrictions. Startup, recovery, damage, hitstun and the buffer duration are unchanged. This is a targeted responsiveness repair, not a complete Ultimate input-system port.

## Reference and diagnosis

- [Ultimate Frame Data: Link](https://ultimateframedata.com/link) documents jab 2 becoming available on frame 12 of jab 1, jab 3 on frame 8 of jab 2, and the optional forward-smash swing on frame 22. Existing zero-based windows in `Link.ts` already match those openings.
- [Original Ultimate buffering investigation](https://smashboards.com/threads/ultimate-buffering-system.465269/) is the primary investigation linked by SmashWiki, but automated access was blocked during this review. [SmashWiki's buffer overview](https://www.ssbwiki.com/Buffer) is a useful further-reading index; its complete held-buffer semantics were not independently verified here.
- The current runtime already has nine-step attack and jump buffers, three-step jumpsquat, landing recovery, hitlag/hitstun and authored jab chains. Adding a separate universal combo timer would not address the observed dispatch mismatch.
- Offensive buffering currently captures fresh edges; holding an early input does not refresh an expired request. General held-input behavior needs a separate design and regression pass, especially around charges, repeated attacks and accidental dodges.
- Dodge and grab paths have their own eligibility and edge checks rather than sharing the offensive queue. Their transitions deserve a separate audit.
- Combo availability also depends on recovery plus movement and next-move startup versus the defender's remaining hitstun and reachable position. Percent, launch direction and defensive influence matter; buffering alone cannot establish that the game feels like Smash.

## Regression coverage

Real Matter tests cover an early released jab tap activating at the opening, both jab transitions, one tap advancing only one stage, expiration outside the buffer, and both light/heavy inputs buffering Link's second forward-smash swing. Existing checks cover fresh presses and holding attack without automatically performing the optional swing.

Validation: `Character.test.ts` and `Link.normals.physics.test.ts` pass **478 tests across two files**; `tsc --noEmit` passes. WSL's asynchronous module reads caused a Vitest startup parse failure, so the test run used a temporary Node loader that read module sources synchronously. The loader was removed afterward. No production build or browser/controller playtest was run for this change.

Human controller playtesting is still needed to assess the reported overall feel. No full-roster balance or exact Ultimate parity claim is made.
