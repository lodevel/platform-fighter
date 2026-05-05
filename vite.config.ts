import { defineConfig } from 'vite';
import path from 'path';

// `base` is the deploy sub-path. GitHub Pages serves project repos at
// `https://<user>.github.io/<repo>/`, so the production bundle plus every
// URL produced by `import.meta.env.BASE_URL` (see `src/assets/manifest.ts`)
// must include that prefix. In dev (`npm run dev`) we keep `base = '/'`
// so the local server stays at `http://localhost:5173/`.
const PROD_BASE = '/platform-fighter/';

export default defineConfig(({ command }) => ({
  root: '.',
  base: command === 'build' ? PROD_BASE : '/',
  publicDir: 'assets',
  server: {
    host: '0.0.0.0',
    port: 5173,
    open: false,
    strictPort: false,
  },
  preview: {
    port: 4173,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
    chunkSizeWarningLimit: 4000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@engine': path.resolve(__dirname, 'src/engine'),
      '@scenes': path.resolve(__dirname, 'src/scenes'),
      '@characters': path.resolve(__dirname, 'src/characters'),
      '@stages': path.resolve(__dirname, 'src/stages'),
      '@input': path.resolve(__dirname, 'src/input'),
      '@ai': path.resolve(__dirname, 'src/ai'),
      '@replay': path.resolve(__dirname, 'src/replay'),
      '@builder': path.resolve(__dirname, 'src/builder'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@types': path.resolve(__dirname, 'src/types'),
    },
  },
  optimizeDeps: {
    include: ['phaser'],
  },
}));
