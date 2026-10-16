# WSL GPU capability check — 2026-10-15

A read-only Chromium context check proves that this WSL environment can use the NVIDIA GPU. The default headless launch uses SwiftShader. Earlier match timing probes explicitly selected SwiftShader, so those measurements describe the software renderer and do not establish the user’s hardware frame rate. No gameplay benchmark was run in this check.

## Observed results

Playwright Chromium **148.0.7778.96**, installed at `/home/lombet/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`, was launched sequentially under `.tmp/dk-heavy.lock`. Both WebGL1 and WebGL2 created, cleared a 2×2 canvas and returned pixels without a GL error.

| Launch | Actual unmasked renderer | Maximum texture size | GPU compositing / WebGL |
| --- | --- | ---: | --- |
| Headless default | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 8192 | software / software |
| Headless Mesa D3D12 + ANGLE EGL | ANGLE (Microsoft Corporation, D3D12 (NVIDIA GeForce RTX 4070 Laptop GPU), OpenGL ES 3.1) | 16384 | enabled / enabled |

The hardware launch’s CDP GPU information also identifies Mesa 25.2.8 and enables GPU rasterization. Its clear/readback was `[64, 127, 191, 255]` with GL error 0; default SwiftShader returned `[64, 128, 191, 255]` with GL error 0. The one-unit channel difference is recorded rather than treated as an image-parity gate.

Exact tested Playwright configuration (settings affect only this child process):

```js
await chromium.launch({
  headless: true,
  env: {
    ...process.env,
    GALLIUM_DRIVER: 'd3d12',
    MESA_D3D12_DEFAULT_ADAPTER_NAME: 'NVIDIA',
  },
  args: [
    '--enable-gpu',
    '--use-gl=angle',
    '--use-angle=gl-egl',
    '--ignore-gpu-blocklist',
  ],
});
```

The two configurations changed several settings together. This check does not determine which subset is sufficient. Neither configuration forced SwiftShader. No Vulkan or native Windows browser was needed after this EGL hardware path succeeded. `Browser.getBrowserCommandLine` is unavailable in this browser because its automation flag is absent; that optional diagnostic failure is retained in the report and did not prevent direct context inspection or CDP GPU inspection.

## Installed environment

- `/dev/dxg` exists and is readable/writable; WSL provides `libd3d12.so` and `libdxcore.so` in `/usr/lib/wsl/lib`.
- `/usr/lib/wsl/lib/nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,pci.bus_id --format=csv` reports **NVIDIA GeForce RTX 4070 Laptop GPU**, driver **592.82**, **8188 MiB** total, **0 MiB** used at the inventory instant, bus `00000000:01:00.0`. These figures come from the NVIDIA query, not the truncated Windows AdapterRAM field.
- Installed EGL/GL/Gallium and Mesa Vulkan packages are **25.2.8-0ubuntu0.24.04.2**. GLVND loads `libEGL_mesa.so.0`; D3D12 is available through the installed Gallium implementation. No drivers were installed or changed.
- The inherited display environment is `DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-0`, `XDG_RUNTIME_DIR=/run/user/1000`. No inherited Mesa/Gallium software override was present in the recorded environment.
- Windows Chrome and Edge executables are present in their standard Program Files locations. They were not launched; WSL hardware acceleration was already demonstrated.

[report.json](report.json) contains exact WebGL context results, compression extensions, CDP GPU feature states, process-local options and timestamps. [renderer-probe.mjs](renderer-probe.mjs) is the diagnostic script; run it from the repository root using the installed Playwright dependency and the heavy lock. It opens only a blank data page.

This is a capability result, not an assertion that the complete game is fast. A separate measured game run using this proven hardware launch, actual renderer identity and the same production bundle would be needed to quantify hardware performance. Application source, assets, shared preview servers, installed drivers and persistent configuration were unchanged.
