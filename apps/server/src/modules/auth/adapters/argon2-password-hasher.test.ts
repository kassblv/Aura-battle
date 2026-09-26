import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from './argon2-password-hasher.js';

/**
 * Le vrai argon2id, pas un double : c'est ici qu'on verifie les parametres
 * reellement ecrits dans le hache.
 */
describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('produit un hache argon2id aux parametres OWASP', async () => {
    const hash = await hasher.hash('aura du dimanche');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain('aura du dimanche');
  });

  it('sale chaque hache : deux joueurs au meme mot de passe ne se ressemblent pas', async () => {
    expect(await hasher.hash('meme phrase')).not.toBe(await hasher.hash('meme phrase'));
  });

  it('verifie le bon mot de passe et refuse les autres', async () => {
    const hash = await hasher.hash('aura du dimanche');
    await expect(hasher.verify(hash, 'aura du dimanche')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'Aura du dimanche')).resolves.toBe(false);
    await expect(hasher.verify(hash, '')).resolves.toBe(false);
  });

  it('refuse sans lever sur un hache illisible', async () => {
    await expect(hasher.verify('pas-un-hache', 'x')).resolves.toBe(false);
    await expect(hasher.verify('', 'x')).resolves.toBe(false);
  });
});
