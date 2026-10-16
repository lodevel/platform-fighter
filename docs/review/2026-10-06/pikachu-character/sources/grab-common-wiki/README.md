# Published grab and release mechanics

October8 acquisition retains revision-pinned MediaWiki API captures and hashes
in [captures.json](captures.json). This is additional source evidence, not a
runtime implementation or native common-status parity claim.

[Grab revision2062344](https://www.ssbwiki.com/index.php?title=Grab&oldid=2062344)
provides Ultimate-applicable entry-percent hold duration
`floor(90 + 1.7 * percentAtCapture)`, stick/button mash reductions8/14.4 and
post-release grab immunity60frames. Later pummel damage does not recalculate
entry percent. The stated minimum19-frame grab time does not by itself resolve
whether the native consumer clamps elapsed eligibility or remaining time;
preserve that distinction when implementing. Button input acceptance frequency
also needs its own rule.

[Grab release revision2045585](https://www.ssbwiki.com/index.php?title=Grab_release&oldid=2045585)
states29frames of action restriction for both sides of an Ultimate nonthrow
release, including aerial release. Source slide/arc velocities and motion-rate
mapping remain unresolved; resource endpoints do not establish either.

The two pages disagree on simultaneous-grab damage:1% versus1.2%. Do not silently
choose a number. Hold timeout, mash escape, captor interruption and throw release
are distinct reasons, and a throw must retain its own launch/status contract.
