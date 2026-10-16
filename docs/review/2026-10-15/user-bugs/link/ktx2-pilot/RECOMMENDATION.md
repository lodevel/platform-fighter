# Recommendation after three failed Link idle experiments

Keep the accepted PNG path in production and leave Link KTX2 explicitly
unfinished. Original UASTC RGBA quality 2, original quality 4, and the newly
executed opaque-RGB/lossless-alpha quality-4 experiment all fail the unchanged
quality gates. Do not encode the remaining representatives or full bank from
any of these recipes, or count a loader that always selects PNG as compressed
delivery.

The [split-alpha receipt](split-alpha-idle/quality.json) is now measured evidence,
not an untested proposed solution. It makes alpha exact and passes flat, ink
and the original alpha-halo checks in all 11 drawings, but every drawing still
fails RGB ≥42 dB. Atlas RGB is 38.648 dB through RGBA8 and 38.477 dB through
BC7. RGB blocks plus exact R8 alpha total 711,360 bytes (0.6784 MiB), twice the
original block payload, before driver/CPU overhead. No runtime path was added.
See the [strategy audit](strategy-audit.md) for individual ranges and controls.

A zero alpha-halo metric also misses 542 transparent texels with nonzero
premultiplied RGB, up to 17/255. Premultiplied blending can add that colour to
the background. Neither exact alpha nor a future numeric pass alone establishes
filtered GPU edge parity. The light/dark composited contacts retain visible
colour-boundary and equipment-detail error; no clamping or threshold change
conceals it.

There is no higher UASTC search preset exposed by the pinned 4.4.2 CLI:
quality 4 was tested with RDO already off. Zstd changes outer storage. Switching
these failed UASTC blocks to ASTC cannot recover their lost texels: UASTC→ASTC
is lossless with respect to the already encoded image. The codec facts are
specified by the [primary UASTC specification](https://github.com/BinomialLLC/basis_universal/wiki/UASTC-Texture-Specification/b624c07ad3c659e7b0f0badcb36e9a6b8820a99d);
the [official KTX encoding reference](https://github.khronos.org/KTX-Software/ktxtools/ktx_create.html)
and installed CLI help document the relevant encoder controls. The current
online reference is version 5; the actual receipts pin version 4.4.2.

The next concrete design decision is whether to investigate a **fresh direct
ASTC encode from the source PNG**, accepting that its target support and
fallback coverage differ from the portable UASTC plan, or choose another
storage/rendering representation after estimating its real memory cost.
Direct exhaustive ASTC is a legitimate remaining bounded diagnostic because
it searches a different format space; it has **not been run or accepted**.
No result here predicts it will satisfy the existing sprite gates. Source
PNG remains the usable implementation while that decision is unresolved.

Any further experiment should remain idle-only until the unchanged per-drawing
and atlas gates plus composited contact review pass. Only then revisit jab,
denser entry and both Finals. Actual target GPU checks, filtering/colour/alpha
parity, supported-format logging, measured residency, RGBA fallback, runtime
loading and deployment/transcoder assets remain required before full-bank
compression can be delivered. DK/Pikachu compression and general roster budget
policy remain outside this Link-only investigation.
