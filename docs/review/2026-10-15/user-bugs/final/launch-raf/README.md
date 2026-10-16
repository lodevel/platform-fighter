# Ordinary launch on normal RAF

Candidate `game-rdv3pg8d.js`, source `b242558d…`. Three explicit accepted-hit
presentation fixtures use the real hit API at 100% damage, an 18% packet,
base 14 / growth 0 knockback, and a 25° launch. This is not attack-input or
collision-admission proof. After applying the hit, only normal browser RAF
advances physics and renders; the launched pose is not pre-uploaded by a
diagnostic draw.

Link, DK and Pikachu remain resident, submitted and visible inside the
viewport throughout their 1.54–1.59 second observations. Zero missing
drawings, stock losses, position-reset generations or unhandled errors
occur. Their world trajectories cover roughly 830–906 pixels; the bodies
do not disappear immediately.

This headless SwiftShader run does not establish 60 FPS: Link produced 15
draw observations / 71 fixed ticks, DK 14 / 71, Pikachu 35 / 60. Maximum RAF
gaps were 283, 200 and 233 ms, with at most six fixed ticks between draws.
The simulation clock was not slowed or otherwise modified. Full positions,
velocities, actual projected body bounds, drawing keys and wall timestamps
are retained in `report.json` for assessing pacing and its limits.
