import { describe, expect, it } from 'vitest';
import { SEASON_MS, seasonsToCreate } from './season-calendar.js';

const FIRST = { number: 1, startsAt: new Date('2026-09-01T00:00:00Z') };
const first = { ...FIRST, endsAt: new Date(FIRST.startsAt.getTime() + SEASON_MS) };

describe('seasonsToCreate', () => {
  it('cree la premiere saison quand il n y en a aucune', () => {
    const created = seasonsToCreate(null, new Date('2026-09-10T00:00:00Z'), FIRST.startsAt);
    expect(created[0]).toEqual(first);
  });

  /*
    Le seed tourne a chaque demarrage, mais un serveur peut tourner des
    semaines sans redemarrer : il faut toujours la saison SUIVANTE deja en
    base, sinon le classement et le passe perdent leur saison courante a
    minuit le jour du changement.
  */
  it('garde toujours la saison suivante d avance', () => {
    const created = seasonsToCreate(first, new Date('2026-09-10T00:00:00Z'), FIRST.startsAt);
    expect(created).toEqual([
      { number: 2, startsAt: first.endsAt, endsAt: new Date(first.endsAt.getTime() + SEASON_MS) },
    ]);
  });

  // Enchainees sans trou ni chevauchement, meme apres une longue absence.
  it('rattrape plusieurs saisons d affilee, bout a bout', () => {
    const now = new Date(first.endsAt.getTime() + 3 * SEASON_MS + 1);
    const created = seasonsToCreate(first, now, FIRST.startsAt);
    expect(created.map((s) => s.number)).toEqual([2, 3, 4, 5, 6]);
    for (let i = 1; i < created.length; i += 1) {
      expect(created[i]!.startsAt).toEqual(created[i - 1]!.endsAt);
    }
    expect(created.at(-1)!.startsAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('ne cree rien quand la suivante existe deja', () => {
    const second = {
      number: 2,
      startsAt: first.endsAt,
      endsAt: new Date(first.endsAt.getTime() + SEASON_MS),
    };
    expect(seasonsToCreate(second, new Date('2026-09-10T00:00:00Z'), FIRST.startsAt)).toEqual([]);
  });
});
