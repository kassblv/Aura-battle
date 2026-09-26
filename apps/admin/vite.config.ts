import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const packageSrc = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

/**
 * Les routes d'API du panneau. L'application vit sous `/admin/` elle aussi :
 * elle se route par le hash (`#/joueurs`) pour ne jamais entrer en collision
 * avec elles, et le serveur de dev ne relaie que celles-ci.
 */
const API_ROUTES = ['status', 'indicators', 'experiments', 'flags', 'events', 'players', 'audit'];

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  resolve: {
    // Sources plutot que dist, comme apps/mobile : editer le contrat admin
    // rafraichit le panneau sans etape de build intermediaire.
    alias: {
      '@aura/rules': packageSrc('rules'),
      '@aura/protocol': packageSrc('protocol'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      [`^/admin/(${API_ROUTES.join('|')})(/|\\?|$)`]: {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
});
