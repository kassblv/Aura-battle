import { describe, expect, it } from 'vitest';
import { InviteService } from './invites.js';

const NOW = 1_700_000_000_000;

describe('InviteService — jouer avec un ami sans passer par la file', () => {
  it('rend un code lisible a voix haute', () => {
    const invite = new InviteService().create('p_1', NOW);
    // Majuscules et chiffres seulement : un code se dicte au telephone.
    expect(invite.code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('rend un lien profond utilisable par l application', () => {
    const invite = new InviteService().create('p_1', NOW);
    expect(invite.deepLink).toBe(`aurabattle://invite/${invite.code}`);
  });

  it('donne une date d expiration dans le futur', () => {
    const invite = new InviteService().create('p_1', NOW);
    expect(invite.expiresAt).toBeGreaterThan(NOW);
  });

  it('ne rend jamais deux fois le meme code', () => {
    const service = new InviteService();
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      codes.add(service.create(`p_${String(i)}`, NOW).code);
    }
    expect(codes.size).toBe(200);
  });

  it('laisse un ami rejoindre et rend l hote', () => {
    const service = new InviteService();
    const invite = service.create('p_1', NOW);
    const result = service.join(invite.code, 'p_2', NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hostId).toBe('p_1');
  });

  it('accepte un code en minuscules, saisi a la main', () => {
    const service = new InviteService();
    const invite = service.create('p_1', NOW);
    expect(service.join(invite.code.toLowerCase(), 'p_2', NOW).ok).toBe(true);
  });

  it('refuse un code inconnu', () => {
    const result = new InviteService().join('ZZZZZZ', 'p_2', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVITE_NOT_FOUND');
  });

  it('refuse un code expire', () => {
    const service = new InviteService();
    const invite = service.create('p_1', NOW);
    const result = service.join(invite.code, 'p_2', invite.expiresAt + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVITE_EXPIRED');
  });

  it('consomme le code : un seul ami peut rejoindre', () => {
    const service = new InviteService();
    const invite = service.create('p_1', NOW);
    expect(service.join(invite.code, 'p_2', NOW).ok).toBe(true);
    const second = service.join(invite.code, 'p_3', NOW);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('INVITE_NOT_FOUND');
  });

  it('empeche un joueur de se rejoindre lui-meme', () => {
    const service = new InviteService();
    const invite = service.create('p_1', NOW);
    const result = service.join(invite.code, 'p_1', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVITE_NOT_FOUND');
  });

  it('ne garde qu une invitation vivante par joueur', () => {
    const service = new InviteService();
    const premiere = service.create('p_1', NOW);
    const seconde = service.create('p_1', NOW);
    // Creer une nouvelle invitation annule la precedente : sinon un joueur
    // sement des codes valides derriere lui a chaque hesitation.
    expect(service.join(premiere.code, 'p_2', NOW).ok).toBe(false);
    expect(service.join(seconde.code, 'p_2', NOW).ok).toBe(true);
  });

  it('oublie les invitations perimees au lieu de les accumuler', () => {
    const service = new InviteService();
    for (let i = 0; i < 50; i += 1) service.create(`p_${String(i)}`, NOW);
    expect(service.size).toBe(50);
    // Une creation posterieure declenche le nettoyage.
    service.create('p_tardif', NOW + 60 * 60 * 1_000);
    expect(service.size).toBe(1);
  });
});
