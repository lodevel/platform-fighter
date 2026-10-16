import path from 'node:path';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import portConfig from './port/vite.config';

/** The production app is the Three.js/HTML host over the shared MatchSim. */
export default defineConfig(({ command }) => mergeConfig(portConfig, {
  root: path.resolve(__dirname, 'port'),
  base: command === 'build' ? '/platform-fighter/' : '/',
  build: {
    outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true,
    sourcemap: true, chunkSizeWarningLimit: 4000,
  },
  server: { host: '0.0.0.0', port: 5173, strictPort: false, open: false },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true },
  test: {
    root: __dirname,
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'port/src/**/*.check.ts'],
    exclude: [...configDefaults.exclude, '.tmp/**', 'docs/**'],
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
}));
