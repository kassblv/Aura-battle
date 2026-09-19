/// <reference types="vite/client" />

/**
 * Variables d'environnement exposees au client.
 *
 * Vite type `import.meta.env` avec une signature d'index en `any`, ce qui fait
 * disparaitre toute verification. On declare donc explicitement les variables du
 * projet : une faute de frappe devient une erreur de compilation, et une
 * variable absente est typee `undefined` plutot que `any`.
 */
interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
