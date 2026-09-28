import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const packageSrc = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // On pointe les packages partages vers leurs sources plutot que vers dist :
    // editer @aura/rules rafraichit le client sans etape de build intermediaire.
    alias: {
      '@aura/rules': packageSrc('rules'),
      '@aura/protocol': packageSrc('protocol'),
      '@aura/content': packageSrc('content'),
    },
  },
  server: {
    // 0.0.0.0 : le serveur de dev est joignable depuis le telephone sur le meme Wi-Fi.
    host: true,
    port: 5173,
  },
});
