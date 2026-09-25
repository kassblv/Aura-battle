import { describe, expect, it, vi } from 'vitest';
import { AuthError, type Fetcher } from './auth.js';
import { buyItem, equipLoadout, readInventory } from './inventory.js';

const state = {
  wallet: { soft: 120, hard: 0 },
  owned: ['color.gold'],
  loadout: { auraColor: 'color.gold' },
};

const ok = (body: unknown) =>
  vi.fn<Fetcher>(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));

const fails = (status: number, body: unknown = {}) =>
  vi.fn<Fetcher>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('readInventory', () => {
  it('lit l inventaire avec le jeton', async () => {
    const fetcher = ok(state);
    await expect(readInventory('http://srv', 'jeton', { fetcher })).resolves.toEqual(state);

    const call = fetcher.mock.calls[0];
    expect(call?.[0]).toBe('http://srv/inventory');
    expect((call?.[1]?.headers as Record<string, string>).authorization).toBe('Bearer jeton');
  });

  /*
    La reponse est validee meme venant de notre serveur : un mandataire captif
    rend une page de connexion Wi-Fi avec un code 200, et on rangerait du HTML
    a la place d un inventaire.
  */
  it('refuse une reponse qui n a pas la forme attendue', async () => {
    await expect(
      readInventory('http://srv', 'jeton', { fetcher: ok({ wallet: 'beaucoup' }) }),
    ).rejects.toMatchObject({ reason: 'MALFORMED' });
  });
});

describe('buyItem', () => {
  it('envoie l identifiant, et rien d autre', async () => {
    const fetcher = ok(state);
    await buyItem('http://srv', 'jeton', 'color.violet', { fetcher });

    // Le corps est une chaine : c'est `JSON.stringify` qui l'a produite.
    const raw = fetcher.mock.calls[0]?.[1]?.body;
    const body = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['itemId']);
  });

  // 2.2.0 : une MONNAIE, jamais un montant.
  it('envoie la monnaie choisie, et toujours aucun montant', async () => {
    const fetcher = ok(state);
    await buyItem('http://srv', 'jeton', 'color.violet', { fetcher, currency: 'hard' });

    const raw = fetcher.mock.calls[0]?.[1]?.body;
    const body = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
    expect(body).toEqual({ itemId: 'color.violet', currency: 'hard' });
  });

  it('rend l inventaire mis a jour', async () => {
    await expect(
      buyItem('http://srv', 'jeton', 'color.violet', { fetcher: ok(state) }),
    ).resolves.toEqual(state);
  });

  /*
    Les refus du serveur portent un code, pas une phrase. C est le client qui
    choisit les mots — et il les choisit en francais. Traduire cote serveur
    serait un deuxieme endroit ou ecrire la meme chose.
  */
  it('remonte le code de refus du serveur', async () => {
    await expect(
      buyItem('http://srv', 'jeton', 'x', {
        fetcher: fails(403, { code: 'INSUFFICIENT_FUNDS' }),
      }),
    ).rejects.toMatchObject({ reason: 'INSUFFICIENT_FUNDS' });
  });

  it('remonte un rachat comme tel', async () => {
    await expect(
      buyItem('http://srv', 'jeton', 'x', { fetcher: fails(409, { code: 'ALREADY_OWNED' }) }),
    ).rejects.toMatchObject({ reason: 'ALREADY_OWNED' });
  });

  /*
    Le serveur borne les ecritures d'inventaire par joueur. Son refus doit
    arriver avec son nom : « Le serveur a refuse » laisserait croire a un
    achat impossible, alors qu'il suffit d'attendre une seconde.
  */
  it('remonte une limite de debit comme telle, a l achat comme a l equipement', async () => {
    await expect(
      buyItem('http://srv', 'jeton', 'x', { fetcher: fails(429, { code: 'RATE_LIMITED' }) }),
    ).rejects.toMatchObject({ reason: 'RATE_LIMITED' });
    await expect(
      equipLoadout('http://srv', 'jeton', {}, { fetcher: fails(429, { code: 'RATE_LIMITED' }) }),
    ).rejects.toMatchObject({ reason: 'RATE_LIMITED' });
  });

  it('retombe sur REJECTED quand le serveur ne dit pas pourquoi', async () => {
    await expect(
      buyItem('http://srv', 'jeton', 'x', { fetcher: fails(500) }),
    ).rejects.toMatchObject({ reason: 'REJECTED' });
  });

  it('distingue l absence de reseau d un refus', async () => {
    const fetcher = vi.fn<Fetcher>(() => Promise.reject(new Error('hors ligne')));
    await expect(buyItem('http://srv', 'jeton', 'x', { fetcher })).rejects.toMatchObject({
      reason: 'UNREACHABLE',
    });
  });

  it('traduit un jeton refuse', async () => {
    await expect(
      buyItem('http://srv', 'jeton', 'x', { fetcher: fails(401) }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe('equipLoadout', () => {
  it('envoie l equipement en PUT', async () => {
    const fetcher = ok(state);
    await equipLoadout('http://srv', 'jeton', { auraEffect: 'fx.vortex' }, { fetcher });

    expect(fetcher.mock.calls[0]?.[0]).toBe('http://srv/inventory/loadout');
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('PUT');
  });

  it('remonte un equipement refuse', async () => {
    await expect(
      equipLoadout('http://srv', 'jeton', {}, { fetcher: fails(403, { code: 'NOT_OWNED' }) }),
    ).rejects.toMatchObject({ reason: 'NOT_OWNED' });
  });
});
