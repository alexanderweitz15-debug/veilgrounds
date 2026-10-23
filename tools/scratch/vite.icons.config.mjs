// Vite config for the icon contact sheet (tools/scratch/iconSheet.html): serves tools/scratch as root, resolves ../../src.
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'tools/scratch',
  server: { port: 4397, strictPort: true, fs: { allow: ['..', '../..'] } },
  resolve: { alias: {} },
});
