import { describe, expect, it } from 'vitest';
import { intentBubbleEligible, intentBubbleFor } from './intent-bubble.js';

/**
 * Exposition d'un match a la bulle d'intention (spec 2026-09-26, § « Exposition
 * au test ») : partie rapide et invitation seulement, et seulement si tous les
 * sieges reels sont dans le groupe expose.
 */
describe('intentBubbleEligible', () => {
  it.each([
    ['CASUAL', true],
    ['INVITE', true],
    ['RANKED', false],
    ['SOLO', false],
  ] as const)('%s -> %s', (mode, expected) => {
    expect(intentBubbleEligible(mode)).toBe(expected);
  });
});

describe('intentBubbleFor', () => {
  it('expose un match rapide ou d invitation dont tous les sieges reels sont traites', () => {
    expect(intentBubbleFor('CASUAL', ['treatment', 'treatment'])).toBe(true);
    expect(intentBubbleFor('INVITE', ['treatment', 'treatment'])).toBe(true);
  });

  it('n expose jamais le classe, meme entre deux joueurs traites', () => {
    expect(intentBubbleFor('RANKED', ['treatment', 'treatment'])).toBe(false);
  });

  it('un seul temoin suffit a fermer la bulle : le groupe temoin reste propre', () => {
    expect(intentBubbleFor('CASUAL', ['treatment', 'control'])).toBe(false);
    expect(intentBubbleFor('INVITE', ['control', 'treatment'])).toBe(false);
  });

  it('contre un fantome, seul le joueur reel compte', () => {
    expect(intentBubbleFor('CASUAL', ['treatment'])).toBe(true);
    expect(intentBubbleFor('CASUAL', ['control'])).toBe(false);
  });

  it('sans aucun siege reel, rien a exposer', () => {
    expect(intentBubbleFor('CASUAL', [])).toBe(false);
  });
});
