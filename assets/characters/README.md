# Characters

Per-fighter art for the roster: Donkey Kong, Pikachu and Link. Layout:

```
characters/
├── donkeykong/
│   ├── frames.json        # per-clip strip metadata, roots, item attachment poses
│   ├── item-axes.json     # native held-item axis per frame
│   └── animations/        # packed clip strips
├── pikachu/
│   ├── README.md          # Pikachu-specific notes
│   ├── frames.json
│   ├── item-axes.json
│   ├── registered-poses.json
│   ├── pose-batches/
│   └── animations/
└── link/
    ├── frames.json
    ├── item-muzzles.json
    ├── encoded-rgba-v1/
    └── animations/
```

The art is generated in-house through the local ComfyUI pipeline
(`docs/ART-PIPELINE.md`, `docs/ART-STYLE.md`); no third-party sprite pack
is shipped, so nothing here needs an `ATTRIBUTION.md` entry.

`src/assets/manifest.ts` turns each `frames.json` into preload entries;
`heldItemSocket.ts` reads `itemAttachmentPoses` and `item-axes.json`.
Fighters are recoloured at runtime by the palette shader
(`src/characters/paletteSwapShader.ts`); there are no per-palette PNGs.
