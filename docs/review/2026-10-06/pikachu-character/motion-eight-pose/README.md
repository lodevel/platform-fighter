# Eight-pose local forward-tilt candidate

Status: all six new drawings passed art/root roughbeta qualification, and the isolated [eight-pose candidate](http://127.0.0.1:4185/pikachu-motion-preview.html) passes [browser acceptance](acceptance.json). The preview-owning agent inspected all18 pose/neutral screenshots. [Root renderer visual review](visual-review.json) accepts the roughbeta isolated preview after inspecting contact6right/left, contact8right and readyreturnright, in addition to prior direct review of all6new finals and alpha panels. Root did not inspect all18 runtime screenshots. This qualifies one rough normal preview, not a full fighter. Delivered [three-pose4181 preview](http://127.0.0.1:4181/pikachu-motion-preview.html), its evidence and the [corrected-neutral checkpoint](../motion-three-pose-idle-corrected-checkpoint/checkpoint.json) remain unchanged. The user retained local ComfyUI for beta and accepts rough animation polish; collision remains the priority.

| Game frames | Drawing source index | Candidate pose |
| --- | --- | --- |
|1–2|0|startup|
|3–5|4|turn-low|
|6|5|contact-6|
|7|6|contact-7|
|8|7|contact-8|
|9–16|10|extended-recovery|
|17–22|21|recovery|
|23–29|28|ready-return|
|Ready/return after completion|none|accepted side-facing neutral reference|

The original [six-pose art plan](../art/pilot-pose-contract.json) and [six-pose renderer proposal](six-pose-schedule-proposal.ts) remain evidence of the earlier plan. Root explicitly directed replacing its single inactive source8 contact drawing with three actual active-source drawings. The resulting candidate has eight attack drawings plus neutral. Each hold is authored presentation; sampled image indices outside contact are not assertions of frame-perfect native motion.

The source move remains29 frames, active only6–8 and clear from9. The [reviewed2D projector](../sources/forward-tilt-pose.md) and native radii/damage remain unchanged. It uses independent measured positions for all three active frames. Generated pixels cannot move those positions or establish native bone/hurtbox parity. The green40×50 movement rectangle remains distinct from unqualified posed Pikachu vulnerability.

The old contact drawing came from source8, game9, when the hindfoot has retracted. Its approximate guide upper-foot landmark is art(1218,634). The measured outer-region centres map to approximately(1327,628),(1301,621),(1246,615) on active6/7/8: horizontal differences12.72,9.71,3.30 world pixels from that guide landmark. This is a comparison to an authored approximate anatomical marker, not a claim that native attack offsets must equal the limb centre. The [numeric comparison](contact-drawing-gap.json) and [self-contained overlay review](contact-drawing-gap.html) preserve those measurements. The repair targets actual source5/6/7 anatomy and preserves source geometry. Source spheres may still extend beyond correctly sampled visible limbs; art agreement is not permission to trim native radii.

Art owns active limb contours/guides and qualification; root owns serial local GPU submissions. [The candidate art gate](art-approval.json) must pin each reviewed output hash before build. All nine file hashes are pinned after art/root review. Source28's lowest visible forepaw extends2.217worldpixels below the calibrated root and2.365 below the physicalfloor in bothfacings, including0.149Matterrestpenetration; this remains a documented cosmeticbeta caveat; no global recentering or collision adjustment is automatic.

The updated build/acceptance tools use separate `motion-eight-pose-build.json`, candidate evidence in this directory and port4185, preserving delivered manifests and output. Passed verification covers29 frame selections, all eight poses in both facings, six near/edge/miss physics cases, source active/clear boundaries, target deduplication, neutral/reset/return, two manual freezes, pause, registration and nine served PNG/JavaScript hashes. Every frame's full contact-region payload equals the earlier verified preview. [The fresh build manifest](../motion-eight-pose-build.json) pins output and identities. No automatic hitlag or victim launch is exercised by this stationary fixture. Native posed hurtboxes, special values, full fighter coverage and victim launch remain outside this preview.
