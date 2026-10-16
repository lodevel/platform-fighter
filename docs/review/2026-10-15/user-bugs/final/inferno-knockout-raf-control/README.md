# Capture-free head death-flight control

Candidate `game-B95Fcp5p.js`, source identity
`platform-fighter-sha256-74c2fec99c76cdc7942171c69ff8c02f7c207d50263dffea93787a7d94040101`.

The real Inferno clock advances through 1889 setup ticks; an actual recorded
neutral/crouch input frame is held through the flash using the replay input
API. Before releasing normal RAF, the tool waits until the presenter has
flushed and resets the wall timestamp. During the observation there are no
screenshots, polling, additional page evaluations, manual steps or forced
draws. No hazard state, damage, stock or physics speed is forced.

All three standing fighters lose one real stock, `[3,3,3,3]` → `[2,2,2,3]`;
the croucher survives. Each victim has 29 actual submitted native flight
drawings inside the viewport, with zero missing drawings. Visibility uses
the actual trimmed frame's projected quad, including origin, scale, flip
and rotation. DK and Link remain at least 4×4 pixels for 28 observations,
Pikachu for 27. None exits the viewport during its observed lease.

The bodies remain visible for 7970.8 ms in this headless SwiftShader run
(first flight frame 1891, last 1988), with a maximum actual observer gap of
1345.7 ms. This confirms the body presentation is not disappearing
immediately, but **does not qualify frame-rate performance**. Unlike the
older screenshot-contaminated receipt, this control still shows substantial
slow presentation. The GPU/software-rendering contribution needs to be
distinguished from normal user hardware before assigning a cause. Zero
unhandled page errors or match faults occurred.
