import { describe, expect, it } from 'vitest';
import type { PlayerRecord, PlayerRepository } from '../domain/ports.js';
import { ProfileError, ProfileService } from './profile.js';

function repository(players: PlayerRecord[] = []): PlayerRepository & { readonly renames: number } {
  const byId = new Map(players.map((player) => [player.id, player]));
  let renames = 0;
  return {
    get renames() {
      return renames;
    },
    findByDeviceHash: () => Promise.resolve(null),
    findById: (id) => Promise.resolve(byId.get(id) ?? null),
    createWithDeviceIdentity: () => {
      throw new Error('inattendu');
    },
    // Ce cas d usage ne rattache aucun appareil : le double le dit plutot que
    // de faire semblant d en etre capable.
    joinDevice: () => {
      throw new Error('non utilise');
    },
    linkDeviceIdentity: () => {
      throw new Error('inattendu');
    },
    touchLastSeen: () => Promise.resolve(),
    rename: (id, displayName) => {
      renames += 1;
      const player = byId.get(id);
      if (player === undefined) return Promise.resolve(null);
      const renamed = { ...player, displayName };
      byId.set(id, renamed);
      return Promise.resolve(renamed);
    },
  };
}

const alice: PlayerRecord = { id: 'p_1', displayName: 'Invite 4417' };

describe('ProfileService.rename', () => {
  it('change le nom affiche', async () => {
    const players = repository([alice]);
    const renamed = await new ProfileService({ players }).rename('p_1', 'Kassim');
    expect(renamed.displayName).toBe('Kassim');
  });

  /**
   * Le schema partage rogne les espaces ; le service ecrit la valeur rognee,
   * pas la saisie. Sans cela, deux joueurs nommes « Kassim » et « Kassim  »
   * paraissent distincts et se confondent a l'affichage.
   */
  it('ecrit le nom rogne, pas la saisie brute', async () => {
    const players = repository([alice]);
    const renamed = await new ProfileService({ players }).rename('p_1', '  Kassim  ');
    expect(renamed.displayName).toBe('Kassim');
  });

  it('refuse un nom que le schema partage rejette', async () => {
    const players = repository([alice]);
    const service = new ProfileService({ players });
    await expect(service.rename('p_1', 'K')).rejects.toBeInstanceOf(ProfileError);
    // Rien n'a ete ecrit : la validation precede la base.
    expect(players.renames).toBe(0);
  });

  it('refuse un joueur inconnu sans reveler lequel', async () => {
    const service = new ProfileService({ players: repository([]) });
    await expect(service.rename('p_absent', 'Kassim')).rejects.toMatchObject({
      reason: 'PLAYER_NOT_FOUND',
    });
  });

  /**
   * Deux joueurs peuvent porter le meme nom.
   *
   * Exiger l'unicite transforme les pseudos en course a la reservation, et
   * impose « Kassim1234 » a tous ceux qui arrivent apres. L'identite d'un
   * joueur est son identifiant, pas son nom — c'est lui que le serveur
   * manipule partout.
   */
  it('laisse deux joueurs porter le meme nom', async () => {
    const players = repository([alice, { id: 'p_2', displayName: 'Invite 9002' }]);
    const service = new ProfileService({ players });
    await service.rename('p_1', 'Nova');
    await expect(service.rename('p_2', 'Nova')).resolves.toMatchObject({ displayName: 'Nova' });
  });

  it('accepte de renommer avec le meme nom', async () => {
    // Renvoyer une erreur ferait echouer un formulaire soumis deux fois.
    const players = repository([{ id: 'p_1', displayName: 'Kassim' }]);
    await expect(new ProfileService({ players }).rename('p_1', 'Kassim')).resolves.toMatchObject({
      displayName: 'Kassim',
    });
  });
});
