# Team workflow

Use collaborating agents for this project, as requested by the user. Give each
agent clear file ownership and coordinate changes to shared simulation code,
asset banks and build outputs. Serialize heavy jobs with `.tmp/dk-heavy.lock`.
The coordinating agent integrates the work and validates the combined build.

# Character work

For creating, completing or auditing a playable fighter, use
[$add-character](.agents/skills/add-character/SKILL.md). Apply the relevant parts
for a targeted character fix. The skill defines source coverage, input and
move conditions, animation/collision authoring, image generation and runtime
verification. Keep the character's evidence record current; do not equate
compiled data or passing unit tests with verified behavior in a match.
