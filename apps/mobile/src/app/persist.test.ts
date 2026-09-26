import { describe, expect, it } from 'vitest';
import { loadProgress, saveProgress, type Progress } from './persist.js';
import { defaultLook } from './wardrobe.js';

function memory(initial?: string): { read: () => string | null; write: (v: string) => void } {
  let value = initial ?? null;
  return {
    read: () => value,
    write: (next: string) => {
      value = next;
    },
  };
}

const progress = (over: Partial<Progress> = {}): Progress => ({
  look: defaultLook(),
  owned: [],
  wallet: { soft: 0, hard: 0 },
  ...over,
});

describe('loadProgress / saveProgress', () => {
  it('rend ce qu on lui a confie', () => {
    const store = memory();
    const saved = progress({ owned: ['anim.hype.t2.floss'], wallet: { soft: 420, hard: 3 } });
    saveProgress(store, saved);
    expect(loadProgress(store)).toEqual(saved);
  });

  it('rend null quand rien n a ete range', () => {
    expect(loadProgress(memory())).toBeNull();
  });

  /**
   * `localStorage` ne rend pas `null` quand les donnees de site sont bloquees :
   * il **leve**. Un jeu qui plante au lancement en navigation privee est un jeu
   * qu'on desinstalle.
   */
  it('survit a un stockage qui leve', () => {
    const hostile = {
      read: () => {
        throw new Error('bloque');
      },
      write: () => {
        throw new Error('bloque');
      },
    };
    expect(() => saveProgress(hostile, progress())).not.toThrow();
    expect(loadProgress(hostile)).toBeNull();
  });

  it('ignore un contenu illisible', () => {
    expect(loadProgress(memory('{ pas du json'))).toBeNull();
  });

  /**
   * Ces donnees sont **provisoires** : le serveur tiendra l'inventaire au
   * jalon M5. Le numero de version est ce qui permettra de les jeter sans
   * ceremonie ce jour-la, plutot que de deviner ce qu'un ancien format
   * contenait.
   */
  it('jette une version qu il ne connait pas', () => {
    const store = memory();
    saveProgress(store, progress({ wallet: { soft: 99, hard: 0 } }));
    const raw = JSON.parse(store.read()!) as { version: number };
    store.write(JSON.stringify({ ...raw, version: raw.version + 1 }));
    expect(loadProgress(store)).toBeNull();
  });

  /**
   * Un cosmetique retire du catalogue ne doit pas survivre dans les
   * possessions : il s'afficherait comme equipe sans exister, et le vestiaire
   * montrerait un emplacement vide qu'on croit rempli.
   */
  it('oublie une possession qui n est plus au catalogue', () => {
    const store = memory();
    saveProgress(store, progress({ owned: ['anim.hype.t2.floss', 'objet.disparu'] }));
    expect(loadProgress(store)?.owned).toEqual(['anim.hype.t2.floss']);
  });

  it('refuse une bourse qui n est pas un compte entier positif', () => {
    for (const wallet of [
      { soft: -10, hard: 0 },
      { soft: 1.5, hard: 0 },
      { soft: Number.NaN, hard: 0 },
    ]) {
      const store = memory();
      saveProgress(store, progress());
      const raw = JSON.parse(store.read()!) as Record<string, unknown>;
      store.write(JSON.stringify({ ...raw, wallet }));
      expect(loadProgress(store)).toBeNull();
    }
  });

  it('refuse une apparence incomplete', () => {
    const store = memory();
    saveProgress(store, progress());
    const raw = JSON.parse(store.read()!) as { look: Record<string, unknown> };
    store.write(JSON.stringify({ ...raw, look: { outfit: 'outfit.noir' } }));
    expect(loadProgress(store)).toBeNull();
  });
});

describe('qualite graphique', () => {
  /*
    Deux valeurs, et pas une : le reglage que le joueur a choisi, et le palier
    que l automatique a trouve. Sans le second, un appareil modeste repaye une
    premiere manche hachee a chaque lancement — le gouverneur repart du plus
    haut palier et redescend.
  */
  it('range le reglage et le palier trouve', () => {
    const store = memory();
    const saved = progress({ quality: 'auto', qualityTier: 'balanced' });
    saveProgress(store, saved);
    expect(loadProgress(store)).toEqual(saved);
  });

  it('range un palier impose a la main', () => {
    const store = memory();
    saveProgress(store, progress({ quality: 'smooth', qualityTier: 'smooth' }));
    expect(loadProgress(store)?.quality).toBe('smooth');
  });

  it('accepte une sauvegarde d avant les paliers', () => {
    const store = memory();
    saveProgress(store, progress());
    const loaded = loadProgress(store);
    expect(loaded).not.toBeNull();
    expect(loaded?.quality).toBeUndefined();
    expect(loaded?.qualityTier).toBeUndefined();
  });

  /*
    Le stockage est editable a la main. Un palier invente ne doit pas se
    propager jusqu a `QUALITY_PROFILES[tier]`, ou il vaudrait `undefined` et
    ferait tomber l arene au premier acces.
  */
  it('oublie un palier qui n existe pas', () => {
    const store = memory();
    saveProgress(store, progress());
    const raw = JSON.parse(store.read() ?? '{}') as Record<string, unknown>;
    store.write(JSON.stringify({ ...raw, quality: 'ultra', qualityTier: 'cinema' }));
    const loaded = loadProgress(store);
    expect(loaded).not.toBeNull();
    expect(loaded?.quality).toBeUndefined();
    expect(loaded?.qualityTier).toBeUndefined();
  });
});
