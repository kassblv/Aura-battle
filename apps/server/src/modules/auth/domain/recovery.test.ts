import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  RECOVERY_ALPHABET,
  RECOVERY_CODE_LENGTH,
  RECOVERY_PREFIX,
  formatRecoveryCode,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from './recovery.js';

describe('generateRecoveryCode', () => {
  /*
    Quatre-vingts bits, et ce chiffre n'est pas un gout.

    Le secret d'appareil fait 256 bits, c'est pourquoi `credentials.ts` le
    hache SANS SEL : aucun dictionnaire ne peut exister pour cet espace. Un
    code lisible par un humain ne peut pas faire 256 bits — mais recopier le
    meme hachage sur un code de 60 bits exposerait la base a une attaque hors
    ligne realiste. Seize symboles de cet alphabet en font 80, ce qui remet le
    code hors de portee tout en restant recopiable a la main.
  */
  it('tire seize symboles de l alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRecoveryCode();
      expect(code).toHaveLength(RECOVERY_CODE_LENGTH);
      for (const symbol of code) expect(RECOVERY_ALPHABET).toContain(symbol);
    }
  });

  it('pese au moins quatre-vingts bits', () => {
    expect(Math.log2(RECOVERY_ALPHABET.length) * RECOVERY_CODE_LENGTH).toBeGreaterThanOrEqual(80);
  });

  /*
    L'alphabet de Crockford, et pas base64.

    Un code se lit a voix haute, se recopie d'un ecran a l'autre, parfois
    depuis une photo. `I`, `L`, `O` et `U` en sont retires : les trois
    premieres se confondent avec `1` et `0`, la derniere fabrique des mots
    qu'on ne veut pas afficher a un joueur.
  */
  it('exclut les symboles qui se confondent', () => {
    for (const symbol of ['I', 'L', 'O', 'U']) {
      expect(RECOVERY_ALPHABET).not.toContain(symbol);
    }
    expect(RECOVERY_ALPHABET).toHaveLength(32);
  });

  it('ne rend jamais deux fois le meme', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateRecoveryCode());
    expect(seen.size).toBe(500);
  });
});

describe('formatRecoveryCode', () => {
  it('groupe par quatre, derriere le prefixe', () => {
    expect(formatRecoveryCode('7K2M94PXQTJD3HVN')).toBe(`${RECOVERY_PREFIX}-7K2M-94PX-QTJD-3HVN`);
  });
});

describe('normalizeRecoveryCode', () => {
  it('accepte la forme telle qu elle est affichee', () => {
    expect(normalizeRecoveryCode('AURA-7K2M-94PX-QTJD-3HVN')).toBe('7K2M94PXQTJD3HVN');
  });

  it('accepte la forme nue', () => {
    expect(normalizeRecoveryCode('7K2M94PXQTJD3HVN')).toBe('7K2M94PXQTJD3HVN');
  });

  /*
    Quelqu'un qui recopie un code a la main se trompe de casse, met des
    espaces, oublie un tiret. Refuser pour ca, c'est perdre un joueur sur un
    detail de presentation alors que le code est bon.
  */
  it('pardonne la casse, les espaces et les tirets', () => {
    expect(normalizeRecoveryCode('  aura 7k2m 94px-qtjd_3hvn ')).toBe('7K2M94PXQTJD3HVN');
  });

  /*
    Crockford : `O` se lit zero, `I` et `L` se lisent un. Sans cette
    traduction, un code lu sur une photo est refuse alors qu'il est juste.
  */
  it('traduit les symboles qu on confond en les lisant', () => {
    expect(normalizeRecoveryCode('OK2M94PXQTJD3HVN')).toBe('0K2M94PXQTJD3HVN');
    expect(normalizeRecoveryCode('IK2M94PXQTJD3HVN')).toBe('1K2M94PXQTJD3HVN');
    expect(normalizeRecoveryCode('LK2M94PXQTJD3HVN')).toBe('1K2M94PXQTJD3HVN');
  });

  it('refuse ce qui n a pas la bonne longueur', () => {
    expect(normalizeRecoveryCode('7K2M')).toBeNull();
    expect(normalizeRecoveryCode('7K2M94PXQTJD3HVNZ')).toBeNull();
    expect(normalizeRecoveryCode('')).toBeNull();
  });

  it('refuse un symbole hors alphabet', () => {
    expect(normalizeRecoveryCode('7K2M94PXQTJD3HV$')).toBeNull();
    expect(normalizeRecoveryCode('7K2M94PXQTJD3HVU')).toBeNull();
  });

  /*
    Le prefixe est un habillage, pas une donnee : « AURA » ne doit jamais
    compter dans les seize symboles, ni etre exige.
  */
  it('ne compte pas le prefixe dans la longueur', () => {
    expect(normalizeRecoveryCode('AURA7K2M94PXQTJD3HVN')).toBe('7K2M94PXQTJD3HVN');
  });

  it('fait l aller-retour pour tout code tire', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRecoveryCode();
      expect(normalizeRecoveryCode(formatRecoveryCode(code))).toBe(code);
    }
  });

  it('rend la meme chose quelle que soit la presentation', () => {
    fc.assert(
      fc.property(fc.constantFrom(...Array.from({ length: 50 }, generateRecoveryCode)), (code) => {
        const shown = formatRecoveryCode(code);
        expect(normalizeRecoveryCode(shown.toLowerCase())).toBe(code);
        expect(normalizeRecoveryCode(shown.replaceAll('-', ' '))).toBe(code);
        expect(normalizeRecoveryCode(shown.replaceAll('-', ''))).toBe(code);
      }),
    );
  });
});

describe('hashRecoveryCode', () => {
  it('ne rend jamais le code lui-meme', () => {
    const code = generateRecoveryCode();
    expect(hashRecoveryCode(code)).not.toContain(code);
    expect(hashRecoveryCode(code)).toMatch(/^[0-9a-f]{64}$/);
  });

  /*
    Le hachage porte sur la forme NORMALISEE. Sinon deux presentations du
    meme code donneraient deux haches differents, et un joueur qui recopie
    son code avec les tirets ne retrouverait pas son compte.
  */
  it('hache la forme normalisee, pas la presentation', () => {
    const code = generateRecoveryCode();
    expect(hashRecoveryCode(formatRecoveryCode(code))).toBe(hashRecoveryCode(code));
    expect(hashRecoveryCode(formatRecoveryCode(code).toLowerCase())).toBe(hashRecoveryCode(code));
  });

  it('refuse de hacher ce qui n est pas un code', () => {
    expect(() => hashRecoveryCode('pas-un-code')).toThrow();
  });
});
