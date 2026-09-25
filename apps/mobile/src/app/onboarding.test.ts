import { DISPLAY_NAME_MAX } from '@aura/protocol';
import { describe, expect, it } from 'vitest';
import {
  nameHint,
  needsOnboarding,
  renameStep,
  welcomeStep,
  type StoredIdentity,
} from './onboarding.js';

const named = (displayName: string): StoredIdentity => ({ playerId: 'p_1', displayName });

describe('needsOnboarding', () => {
  it('accueille un joueur qui n a jamais joue', () => {
    expect(needsOnboarding(null)).toBe(true);
  });

  /**
   * Le serveur baptise les invites « Invite 4417 ». C est un nom de secours,
   * pas un choix : tant qu il n a pas ete change, on considere que le joueur
   * n a pas encore dit qui il etait.
   */
  it('propose de se nommer a qui porte encore un nom d invite', () => {
    expect(needsOnboarding(named('Invite 4417'))).toBe(true);
    expect(needsOnboarding(named('invite 9002'))).toBe(true);
  });

  it('laisse tranquille un joueur qui s est deja nomme', () => {
    expect(needsOnboarding(named('Kassim'))).toBe(false);
  });

  it('ne prend pas un vrai pseudo pour un nom d invite', () => {
    // « Invitation » commence par les memes lettres sans etre un nom de secours.
    expect(needsOnboarding(named('Invitation'))).toBe(false);
    expect(needsOnboarding(named('Inviteur'))).toBe(false);
  });
});

describe('nameHint', () => {
  it('ne reproche rien a un champ encore vide', () => {
    // Afficher une erreur avant la premiere frappe met le joueur en faute
    // pour n avoir rien fait.
    expect(nameHint('')).toBeNull();
  });

  it('accepte un nom valide sans rien dire', () => {
    expect(nameHint('Kassim')).toBeNull();
  });

  it('dit ce qui manque, pas qu il y a une erreur', () => {
    expect(nameHint('K')).toMatch(/2 caract/i);
    expect(nameHint('K'.repeat(DISPLAY_NAME_MAX + 1))).toMatch(/16/);
  });

  it('nomme le probleme quand un caractere est refuse', () => {
    expect(nameHint('Kas<b>')).toMatch(/lettres|caract/i);
  });

  it('explique les espaces doubles plutot que de les rogner en silence', () => {
    expect(nameHint('Kas  sim')).toMatch(/espace/i);
  });

  it('ignore les espaces de bord, comme le schema', () => {
    expect(nameHint('  Kassim  ')).toBeNull();
  });
});

describe('welcomeStep', () => {
  const empty = { name: '', email: '', password: '', confirm: '' };
  const creds = {
    email: 'Kassim@Gmail.com ',
    password: 'aura du dimanche',
    confirm: 'aura du dimanche',
  };

  it('enregistre le nom seul quand les identifiants sont vides', () => {
    expect(welcomeStep({ ...empty, name: ' Kassim ' }, false)).toEqual({
      rename: 'Kassim',
      credentials: null,
      problem: null,
      ready: true,
    });
  });

  it('rattache les identifiants et enregistre le nom quand tout est rempli', () => {
    const step = welcomeStep({ name: 'Kassim', ...creds }, false);
    expect(step.ready).toBe(true);
    expect(step.rename).toBe('Kassim');
    expect(step.credentials).toEqual({ email: 'Kassim@Gmail.com', password: 'aura du dimanche' });
  });

  /* S'inscrire sans choisir de nom est permis : le nom d'invite reste. */
  it('permet de creer son compte en gardant le nom d invite', () => {
    const step = welcomeStep({ name: '', ...creds }, false);
    expect(step.ready).toBe(true);
    expect(step.rename).toBeNull();
  });

  it('ne part pas d un formulaire vide : « Plus tard » est la pour ca', () => {
    expect(welcomeStep(empty, false).ready).toBe(false);
  });

  /*
    Des identifiants a moitie remplis ne partent pas en silence sans eux : le
    joueur croirait avoir cree son compte.
  */
  it('dit quoi faire d identifiants a moitie remplis', () => {
    const step = welcomeStep({ ...empty, name: 'Kassim', email: 'k@gmail.com' }, false);
    expect(step.ready).toBe(false);
    expect(step.problem).toMatch(/laisse-les vides/);
  });

  it('bloque sur un mot de passe trop court ou mal confirme', () => {
    expect(
      welcomeStep(
        { name: 'Kassim', email: 'k@gmail.com', password: 'court', confirm: 'court' },
        false,
      ).problem,
    ).toMatch(/8/);
    expect(welcomeStep({ name: 'Kassim', ...creds, confirm: 'autre' }, false).problem).toMatch(
      /identiques/,
    );
  });

  it('bloque sur un nom invalide, meme avec des identifiants corrects', () => {
    expect(welcomeStep({ name: 'K', ...creds }, false).ready).toBe(false);
  });

  /*
    Deuxieme essai apres un renommage refuse : les identifiants sont deja
    rattaches, les renvoyer rendrait EMAIL_ALREADY_LINKED.
  */
  it('ne renvoie pas des identifiants deja rattaches', () => {
    const step = welcomeStep({ name: 'Kassim', ...creds }, true);
    expect(step.credentials).toBeNull();
    expect(step.rename).toBe('Kassim');
    expect(step.ready).toBe(true);
    expect(welcomeStep({ ...empty, ...creds }, true).ready).toBe(true);
  });
});

/*
  Le changement de nom depuis le profil : apres « Plus tard », c'est le seul
  chemin qui reste pour quitter « Invite 4417 ».
*/
describe('renameStep', () => {
  it('accepte un nom valide et different', () => {
    expect(renameStep('Kass', 'Invite 4417')).toEqual({ ready: true, name: 'Kass', problem: null });
  });

  it('ne valide pas le meme nom, ni un champ vide', () => {
    expect(renameStep('  Invite 4417 ', 'Invite 4417').ready).toBe(false);
    expect(renameStep('   ', 'Invite 4417')).toEqual({ ready: false, name: '', problem: null });
  });

  it('dit ce qui manque a un nom invalide', () => {
    const step = renameStep('K', 'Invite 4417');
    expect(step.ready).toBe(false);
    expect(step.problem).toMatch(/Au moins/);
  });
});
