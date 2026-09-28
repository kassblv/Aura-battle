import { describe, expect, it } from 'vitest';
import {
  blobToBase64,
  clipLeftTheGame,
  CLIP_SHARE_TEXT,
  clipFileName,
  shareClip,
  type ShareEnv,
  type WebShareLike,
} from './share.js';

const mp4 = new Blob(['clip'], { type: 'video/mp4' });

/** Un environnement de partage simule : il retient ce qu on lui demande. */
function env(over: Partial<ShareEnv> = {}): ShareEnv & { downloads: string[] } {
  const downloads: string[] = [];
  return {
    native: false,
    loadNative: () => Promise.resolve(null),
    navigator: undefined,
    makeFile: (blob, name) => new File([blob], name, { type: blob.type }),
    download: (_blob, name) => {
      downloads.push(name);
      return true;
    },
    ...over,
    downloads,
  };
}

function webShare(result: 'ok' | 'abort' | 'refuse', canShare = true) {
  const shared: { files: File[]; text: string }[] = [];
  const nav: WebShareLike = {
    canShare: () => canShare,
    share: (data) => {
      shared.push(data);
      if (result === 'abort') return Promise.reject(new DOMException('no', 'AbortError'));
      if (result === 'refuse') return Promise.reject(new DOMException('no', 'NotAllowedError'));
      return Promise.resolve();
    },
  };
  return { nav, shared };
}

describe('clipFileName', () => {
  it('suit le format encode', () => {
    expect(clipFileName('video/mp4')).toBe('aura-battle.mp4');
    expect(clipFileName('video/webm')).toBe('aura-battle.webm');
  });
});

describe('shareClip : web', () => {
  it('passe le fichier et le texte a la feuille de partage', async () => {
    const { nav, shared } = webShare('ok');
    expect(await shareClip(mp4, env({ navigator: nav }))).toBe('shared');
    expect(shared[0]?.text).toBe(CLIP_SHARE_TEXT);
    expect(shared[0]?.files[0]?.name).toBe('aura-battle.mp4');
    expect(shared[0]?.files[0]?.type).toBe('video/mp4');
  });

  it('ne dit rien quand le joueur annule', async () => {
    const shareEnv = env({ navigator: webShare('abort').nav });
    expect(await shareClip(mp4, shareEnv)).toBe('cancelled');
    expect(shareEnv.downloads).toEqual([]);
  });

  it('telecharge le fichier quand le partage de fichier est impossible', async () => {
    const shareEnv = env({ navigator: webShare('ok', false).nav });
    expect(await shareClip(mp4, shareEnv)).toBe('downloaded');
    expect(shareEnv.downloads).toEqual(['aura-battle.mp4']);
  });

  it('telecharge aussi quand le partage refuse malgre canShare', async () => {
    const shareEnv = env({ navigator: webShare('refuse').nav });
    expect(await shareClip(mp4, shareEnv)).toBe('downloaded');
  });

  it('echoue franchement quand rien n est possible', async () => {
    expect(await shareClip(mp4, env({ download: () => false }))).toBe('failed');
  });

  it('ecrit le texte de partage en francais', () => {
    expect(CLIP_SHARE_TEXT).toBe('Mon aura a fait plier la sienne 🔥 Défie-moi sur Aura Battle');
  });
});

describe('shareClip : natif', () => {
  it('passe par le greffon natif, jamais par navigator', async () => {
    const calls: [string, string][] = [];
    const { nav, shared } = webShare('ok');
    const outcome = await shareClip(
      mp4,
      env({
        native: true,
        navigator: nav,
        loadNative: () =>
          Promise.resolve({
            share: (_blob: Blob, name: string, text: string) => {
              calls.push([name, text]);
              return Promise.resolve();
            },
          }),
      }),
    );
    expect(outcome).toBe('shared');
    expect(calls).toEqual([['aura-battle.mp4', CLIP_SHARE_TEXT]]);
    expect(shared).toEqual([]);
  });

  it('distingue l annulation d un echec', async () => {
    const failing = (message: string): ShareEnv =>
      env({
        native: true,
        loadNative: () => Promise.resolve({ share: () => Promise.reject(new Error(message)) }),
      });
    expect(await shareClip(mp4, failing('Share canceled'))).toBe('cancelled');
    expect(await shareClip(mp4, failing('disk full'))).toBe('failed');
  });

  it('echoue sans greffon', async () => {
    expect(await shareClip(mp4, env({ native: true }))).toBe('failed');
  });
});

describe('blobToBase64', () => {
  it('encode le contenu, meme au-dela d une tranche', async () => {
    expect(await blobToBase64(new Blob(['clip']))).toBe(btoa('clip'));
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    const encoded = await blobToBase64(new Blob([big]));
    expect(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))).toEqual(big);
  });
});

/*
  Ce qui compte comme « clip partage » pour l'indicateur de docs/00-vision :
  la feuille de partage, OU le telechargement — sur le web, on telecharge puis
  on poste a la main. Une annulation ou un echec ne partagent rien.
*/
describe('clipLeftTheGame', () => {
  it.each([
    ['shared', true],
    ['downloaded', true],
    ['cancelled', false],
    ['failed', false],
  ] as const)('%s → %s', (outcome, expected) => {
    expect(clipLeftTheGame(outcome)).toBe(expected);
  });
});
