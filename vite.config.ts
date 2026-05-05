import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  base: './',
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
});
