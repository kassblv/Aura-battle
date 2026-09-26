import { describe, expect, it, vi } from 'vitest';
import { lockLandscape, type OrientationLike } from './orientation.js';

function orientation(
  lock: () => Promise<void>,
  type = 'portrait-primary',
): OrientationLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    type,
    lock: async (wanted: string) => {
      calls.push(wanted);
      await lock();
    },
  };
}

describe('lockLandscape', () => {
  it('demande le paysage', async () => {
    const screen = orientation(() => Promise.resolve());
    await expect(lockLandscape(screen)).resolves.toBe(true);
    expect(screen.calls).toEqual(['landscape']);
  });

  /**
   * Le verrou est un bonus, jamais un prerequis.
   *
   * Les navigateurs de bureau ne l implementent pas, et sur mobile il exige
   * souvent le plein ecran : le refus est donc le cas NORMAL, pas une panne.
   * Le laisser remonter arreterait le demarrage de l application pour une
   * fonction de confort — et l avertissement « tourne ton telephone » couvre
   * deja ce cas.
   */
  it('avale un refus et le signale sans lever', async () => {
    const screen = orientation(() => Promise.reject(new Error('NotSupportedError')));
    await expect(lockLandscape(screen)).resolves.toBe(false);
  });

  it('avale une implementation qui leve avant de promettre', async () => {
    const screen: OrientationLike = {
      type: 'portrait-primary',
      lock: () => {
        throw new Error('SecurityError');
      },
    };
    await expect(lockLandscape(screen)).resolves.toBe(false);
  });

  /** Hors navigateur — tests, rendu serveur — il n y a rien a verrouiller. */
  it('ne fait rien sans API d orientation', async () => {
    await expect(lockLandscape(null)).resolves.toBe(false);
  });

  it('ne fait rien si l API n expose pas de verrou', async () => {
    await expect(lockLandscape({ type: 'landscape-primary' })).resolves.toBe(false);
  });

  /**
   * Deja en paysage, on verrouille quand meme : le but n est pas d y arriver,
   * c est d y RESTER. Sans cela, un joueur qui bascule en pleine manche perd
   * l arene au moment ou il vise.
   */
  it('verrouille meme quand on est deja en paysage', async () => {
    const screen = orientation(() => Promise.resolve(), 'landscape-primary');
    await expect(lockLandscape(screen)).resolves.toBe(true);
    expect(screen.calls).toEqual(['landscape']);
  });

  it('n avertit pas dans la console pour un refus attendu', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await lockLandscape(orientation(() => Promise.reject(new Error('NotSupportedError'))));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
