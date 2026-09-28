import { isNative, loadNativeFileSharer, type NativeFileSharer } from '../platform/capacitor.js';

/**
 * Partager le clip (ADR 0017).
 *
 * - sur le web : la feuille de partage du systeme, `navigator.share({ files })` ;
 * - en natif : le fichier ecrit dans le cache, puis `@capacitor/share` ;
 * - sinon : le fichier est TELECHARGE, et l ecran le dit. Un bouton qui ne
 *   fait rien serait pire qu un bouton absent.
 *
 * Rien ne part vers un serveur : pas d envoi, pas de stockage, pas de lien
 * vers une video hebergee.
 */

/** Le texte du partage : c est lui qui voyage avec la video et se lit sous elle. */
export const CLIP_SHARE_TEXT = 'Mon aura a fait plier la sienne 🔥 Défie-moi sur Aura Battle';

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';

/**
 * Le clip a-t-il quitte le jeu ? La feuille de partage, ou le telechargement :
 * sur le web, on telecharge puis on poste a la main. C'est ce que compte
 * l'indicateur « part des matchs partages en clip ».
 */
export function clipLeftTheGame(outcome: ShareOutcome): boolean {
  return outcome === 'shared' || outcome === 'downloaded';
}

/** Le nom du fichier, dont l extension suit le format reellement encode. */
export function clipFileName(type: string): string {
  return type.startsWith('video/webm') ? 'aura-battle.webm' : 'aura-battle.mp4';
}

/** Le strict necessaire de `navigator` pour partager un fichier. */
export interface WebShareLike {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[]; text: string }) => Promise<void>;
}

export interface ShareEnv {
  readonly native: boolean;
  loadNative(): Promise<NativeFileSharer | null>;
  readonly navigator: WebShareLike | undefined;
  makeFile(blob: Blob, name: string): File;
  /** Enregistre le fichier sur l appareil. Rend `false` si c est impossible. */
  download(blob: Blob, name: string): boolean;
}

/** Le partage annule par le joueur n est pas un echec : on n en dit rien. */
function cancelled(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /cancel/i.test(message);
}

export async function shareClip(
  blob: Blob,
  env: ShareEnv = browserShareEnv(),
  text: string = CLIP_SHARE_TEXT,
): Promise<ShareOutcome> {
  const name = clipFileName(blob.type);

  if (env.native) {
    const sharer = await env.loadNative();
    if (sharer === null) return 'failed';
    try {
      await sharer.share(blob, name, text);
      return 'shared';
    } catch (error) {
      return cancelled(error) ? 'cancelled' : 'failed';
    }
  }

  /*
    Aucune attente avant `navigator.share` : le navigateur exige que l appel
    suive le geste du joueur, et un `await` place avant consommerait ce droit.
  */
  const nav = env.navigator;
  const file = env.makeFile(blob, name);
  if (nav?.share !== undefined && nav.canShare?.({ files: [file] }) === true) {
    try {
      await nav.share({ files: [file], text });
      return 'shared';
    } catch (error) {
      if (cancelled(error)) return 'cancelled';
      // Refuse malgre `canShare` (format, droit expire) : on garde le fichier.
    }
  }

  return env.download(blob, name) ? 'downloaded' : 'failed';
}

/** Le contenu d un fichier en base64, comme l attend `Filesystem.writeFile`. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Par tranches : `String.fromCharCode(...bytes)` depasse la pile sur 2 Mo.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function browserDownload(blob: Blob, name: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Le telechargement a le temps de lire l adresse avant qu on la libere.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30_000);
  return true;
}

export function browserShareEnv(): ShareEnv {
  return {
    native: isNative(),
    loadNative: () => loadNativeFileSharer(blobToBase64),
    navigator: typeof navigator === 'undefined' ? undefined : navigator,
    makeFile: (blob, name) => new File([blob], name, { type: blob.type }),
    download: browserDownload,
  };
}
