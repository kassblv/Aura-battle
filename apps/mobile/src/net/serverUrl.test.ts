import { describe, expect, it } from 'vitest';
import { resolveServerUrl } from './serverUrl.js';

/** Le developpement : Vite sert la page, le serveur ecoute ailleurs. */
const DEV = { origin: 'http://192.168.1.20:5173', devPort: 3000 } as const;

describe('resolveServerUrl', () => {
  it('garde une URL distante telle quelle', () => {
    expect(resolveServerUrl('https://api.aura.example', '192.168.1.20', DEV)).toBe(
      'https://api.aura.example',
    );
  });

  it('reecrit localhost quand la page est servie sur le reseau local', () => {
    expect(resolveServerUrl('http://localhost:3000', '192.168.1.20', DEV)).toBe(
      'http://192.168.1.20:3000',
    );
  });

  it('laisse localhost tranquille quand on developpe sur le Mac', () => {
    expect(resolveServerUrl('http://localhost:3000', 'localhost', DEV)).toBe('http://localhost:3000');
  });

  it('retombe sur l hote de la page quand rien n est configure', () => {
    expect(resolveServerUrl(undefined, '192.168.1.20', DEV)).toBe('http://192.168.1.20:3000');
  });

  it('refuse une URL invalide', () => {
    expect(() => resolveServerUrl('pas-une-url', 'localhost', DEV)).toThrow(/VITE_SERVER_URL/);
  });
});

describe('meme origine', () => {
  /*
    En production le client est servi par le serveur lui-meme, derriere un
    proxy en HTTPS : l API vit a la MEME origine, sur le port 443. Le repli
    historique — `http://<hote>:3000` — y fabriquait une adresse en clair sur
    un port ferme, et le jeu s arretait sur « connexion impossible » alors que
    le serveur repondait parfaitement a un chemin pres.

    Ce defaut ne se voit ni au compilateur, ni aux tests d avant, ni en lisant
    le client : il n apparait qu une fois la page servie ailleurs que par Vite.
  */
  const page = { origin: 'https://aura.exemple.io', hostname: 'aura.exemple.io' };

  it('parle a sa propre origine quand rien n est configure', () => {
    expect(resolveServerUrl(undefined, page.hostname, { origin: page.origin })).toBe(page.origin);
  });

  it('garde le port de developpement quand on le demande', () => {
    expect(
      resolveServerUrl(undefined, '192.168.1.20', {
        origin: 'http://192.168.1.20:5173',
        devPort: 3000,
      }),
    ).toBe('http://192.168.1.20:3000');
  });

  it('laisse une URL explicite l emporter sur l origine', () => {
    expect(
      resolveServerUrl('https://api.aura.example', page.hostname, { origin: page.origin }),
    ).toBe('https://api.aura.example');
  });

  /*
    Le pont du developpement reste : sur telephone, `localhost` designe le
    telephone lui-meme, pas le Mac qui sert la page.
  */
  it('reecrit encore un localhost configure quand la page vient d ailleurs', () => {
    expect(
      resolveServerUrl('http://localhost:3000', '192.168.1.20', {
        origin: 'http://192.168.1.20:5173',
        devPort: 3000,
      }),
    ).toBe('http://192.168.1.20:3000');
  });
});
