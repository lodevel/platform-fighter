# Visibility receipt — timing disqualified

This receipt is from `game-rdv3pg8d.js` / `b242558d…`, before the final
view-only Final-owner opacity adjustment. It demonstrates actual living
match stock loss `[3,3,3,3]` → `[2,2,2,3]`, 27 submitted native death-flight
observations for DK, Pikachu and Link, no missing submitted drawing, and no
unhandled page error. The saved screenshot was viewed: the giant head,
three departing fighters, crouching survivor and continuing-match HUD are
visible together.

**The recorded 8330.3 ms flight span and 3133.2 ms maximum RAF gap must not
be cited as intrinsic gameplay timings.** The first RAF timestamp predates
the synchronous setup by about three seconds; the corresponding actual
observer wall gap was only 72 ms. One Playwright screenshot was requested
at frame 1925. Large observed stalls began at frame 1926 and continued
during capture; exact screenshot completion was not timestamped, so the
remaining stalls cannot be separated conclusively from screenshot/GPU
readback overhead. Before capture, ages 5–29 produced 13 visible samples
in about 351 ms.

These rows also did not record projected trimmed-quad bounds, so
`submitted/visible` alone does not certify every sample lay inside the
viewport. The separate screenshot certifies its captured frame only.
The capture-free control on the next candidate collects actual trimmed
quad viewport bounds and pixel sizes, releases from a fresh RAF boundary,
and performs no screenshots, polling or additional evaluations during
the flight. Use that control for pacing and viewport visibility claims.
