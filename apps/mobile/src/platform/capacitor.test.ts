import { describe, expect, it, vi } from 'vitest';
import { appStateWatcher, deepLinkWatcher, type CapacitorAppLike } from './capacitor.js';

/** Faux greffon `App` : on declenche ses evenements a la main. */
function fakeApp() {
  const listeners = new Map<string, (event: never) => void>();
  const removed: string[] = [];
  const app: CapacitorAppLike = {
    addListener: (name, handler) => {
      listeners.set(name, handler);
      return Promise.resolve({
        remove: () => {
          removed.push(name);
          return Promise.resolve();
        },
      });
    },
  };
  return {
    app,
    removed,
    emit(name: string, event: unknown) {
      (listeners.get(name) as ((e: unknown) => void) | undefined)?.(event);
    },
  };
}

describe('appStateWatcher', () => {
  /*
    L app peut etre suspendue en plein match : un message qui arrive, un
    telephone verrouille. Au retour, la socket est morte depuis longtemps et
    l etat affiche date d avant — il faut redemander `match:state` plutot que
    de reprendre une partie fantome.
  */
  it('previent au retour au premier plan', () => {
    const fake = fakeApp();
    const resumed = vi.fn();
    appStateWatcher(fake.app, { onResume: resumed, onPause: vi.fn() });

    fake.emit('appStateChange', { isActive: true });
    expect(resumed).toHaveBeenCalledTimes(1);
  });

  it('previent au passage en arriere-plan', () => {
    const fake = fakeApp();
    const paused = vi.fn();
    appStateWatcher(fake.app, { onResume: vi.fn(), onPause: paused });

    fake.emit('appStateChange', { isActive: false });
    expect(paused).toHaveBeenCalledTimes(1);
  });

  it('ne previent pas deux fois pour le meme etat', () => {
    const fake = fakeApp();
    const resumed = vi.fn();
    appStateWatcher(fake.app, { onResume: resumed, onPause: vi.fn() });

    fake.emit('appStateChange', { isActive: true });
    fake.emit('appStateChange', { isActive: true });
    expect(resumed).toHaveBeenCalledTimes(1);
  });

  it('se desabonne', async () => {
    const fake = fakeApp();
    const stop = appStateWatcher(fake.app, { onResume: vi.fn(), onPause: vi.fn() });
    await stop();
    expect(fake.removed).toEqual(['appStateChange']);
  });

  /* Hors natif il n y a pas de greffon : ce n est pas une panne. */
  it('ne casse rien sans greffon', () => {
    expect(() => appStateWatcher(null, { onResume: vi.fn(), onPause: vi.fn() })).not.toThrow();
  });
});

describe('deepLinkWatcher', () => {
  /*
    Un lien d invitation ouvert alors que l app tourne DEJA n arrive pas par
    l URL de la page : la WebView ne navigue pas, le systeme livre l adresse
    par un evenement. Sans cet ecouteur, le joueur qui touche un lien recu en
    conversation voit son jeu passer au premier plan sans rien faire d autre.
  */
  it('rend le code d invitation d un lien ouvert', () => {
    const fake = fakeApp();
    const invited = vi.fn();
    deepLinkWatcher(fake.app, invited);

    fake.emit('appUrlOpen', { url: 'https://aura.example/duel/7K2M' });
    expect(invited).toHaveBeenCalledWith('7K2M');
  });

  it('ignore une adresse qui ne porte pas d invitation', () => {
    const fake = fakeApp();
    const invited = vi.fn();
    deepLinkWatcher(fake.app, invited);

    fake.emit('appUrlOpen', { url: 'https://aura.example/reglages' });
    fake.emit('appUrlOpen', { url: 'pas-une-url' });
    expect(invited).not.toHaveBeenCalled();
  });

  it('accepte un schema d application', () => {
    const fake = fakeApp();
    const invited = vi.fn();
    deepLinkWatcher(fake.app, invited);

    fake.emit('appUrlOpen', { url: 'aurabattle://open/duel/xy12' });
    expect(invited).toHaveBeenCalledWith('XY12');
  });
});
