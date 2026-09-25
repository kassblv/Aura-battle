/**
 * Le calendrier des saisons : huit semaines chacune, bout a bout.
 *
 * Le seed tourne a chaque demarrage (ADR 0012), mais un serveur peut tourner
 * des semaines sans redemarrer. Il garde donc TOUJOURS la saison suivante
 * d'avance en base : sans elle, le classement et le passe perdraient leur
 * saison courante a minuit le jour du changement, et personne ne le verrait
 * avant la premiere fin de match qui ne compte pour rien.
 */

/** Huit semaines, le rythme annonce dans docs/07. */
export const SEASON_MS = 8 * 7 * 24 * 60 * 60 * 1_000;

export interface SeasonSpan {
  readonly number: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Les saisons a creer pour qu'il en existe une qui n'a pas encore commence.
 *
 * `latest` est la derniere saison en base (ou `null`), `firstStart` le debut
 * de la toute premiere. Chaque saison commence exactement a la fin de la
 * precedente : ni trou, ni chevauchement.
 */
export function seasonsToCreate(
  latest: SeasonSpan | null,
  now: Date,
  firstStart: Date,
): readonly SeasonSpan[] {
  const created: SeasonSpan[] = [];
  let last =
    latest ??
    ((): SeasonSpan => {
      const first = {
        number: 1,
        startsAt: firstStart,
        endsAt: new Date(firstStart.getTime() + SEASON_MS),
      };
      created.push(first);
      return first;
    })();
  while (last.startsAt.getTime() <= now.getTime()) {
    const next = {
      number: last.number + 1,
      startsAt: last.endsAt,
      endsAt: new Date(last.endsAt.getTime() + SEASON_MS),
    };
    created.push(next);
    last = next;
  }
  return created;
}
