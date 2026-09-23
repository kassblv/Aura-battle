import { describe, expect, it } from 'vitest';
import { matchSpoils, type MatchEndFacts } from './spoils.js';

const facts = (over: Partial<MatchEndFacts> = {}): MatchEndFacts => ({
  softCurrency: 0,
  ratingBefore: 1200,
  ratingAfter: 1200,
  leagueBefore: 'stable',
  leagueAfter: 'stable',
  ...over,
});

describe('matchSpoils', () => {
  /*
    Le gain d une partie est la raison d en relancer une. Le serveur le calcule,
    le credite et l envoie dans `match:end` — et l ecran ne le disait pas. Un
    joueur gagnait des pieces sans jamais l apprendre, et decouvrait un total
    different au prochain passage sur l accueil.
  */
  it('annonce les pieces gagnees', () => {
    expect(matchSpoils(facts({ softCurrency: 30 })).coins).toBe(30);
  });

  /*
    Zero ne s annonce pas. « +0 ◈ » apprend au joueur que cette ligne ne vaut
    pas la peine d etre lue, et le jour ou elle porte un vrai chiffre il ne la
    lira plus. C est aussi le cas d un match contre un fantome, qui ne paie
    rien (docs/05).
  */
  it('ne dit rien d un gain nul', () => {
    expect(matchSpoils(facts({ softCurrency: 0 })).coins).toBeNull();
  });

  it('annonce le classement gagne', () => {
    expect(matchSpoils(facts({ ratingBefore: 1200, ratingAfter: 1218 })).lp).toBe(18);
  });

  /*
    Et le classement PERDU, avec son signe. Cacher la perte rendrait le
    classement incomprehensible : on monterait sans jamais descendre, et le
    chiffre affiche sur l accueil finirait par contredire ce que le match
    vient de raconter.
  */
  it('annonce le classement perdu', () => {
    expect(matchSpoils(facts({ ratingBefore: 1200, ratingAfter: 1188 })).lp).toBe(-12);
  });

  /*
    Une partie rapide ne touche pas au classement : les deux valeurs sont
    egales, et « LP ±0 » ferait croire a un mode classe qui n a rien donne.
  */
  it('ne dit rien quand le classement n a pas bouge', () => {
    expect(matchSpoils(facts()).lp).toBeNull();
  });

  /*
    Changer de ligue est le moment le plus gros de la progression : il merite
    d etre nomme, pas deduit d un ecart de points.
  */
  it('nomme la ligue quand elle change', () => {
    const spoils = matchSpoils(
      facts({ ratingAfter: 1400, leagueBefore: 'stable', leagueAfter: 'rayonnante' }),
    );
    expect(spoils.league).toBe('rayonnante');
  });

  it('ne nomme pas la ligue quand elle ne change pas', () => {
    expect(matchSpoils(facts({ ratingAfter: 1250 })).league).toBeNull();
  });

  /*
    Une descente de ligue se nomme aussi. Ne montrer que les montees ferait
    disparaitre le joueur de sa ligue sans explication, et c est exactement le
    genre de silence qui se lit comme un bogue.
  */
  it('nomme aussi une descente de ligue', () => {
    const spoils = matchSpoils(
      facts({ ratingAfter: 900, leagueBefore: 'rayonnante', leagueAfter: 'stable' }),
    );
    expect(spoils.league).toBe('stable');
  });

  /*
    Rien du tout : le solo, ou une partie contre un fantome en mode rapide.
    L appelant doit pouvoir ne RIEN afficher plutot qu un bandeau vide.
  */
  it('dit quand il n y a rien a annoncer', () => {
    expect(matchSpoils(facts()).empty).toBe(true);
    expect(matchSpoils(facts({ softCurrency: 12 })).empty).toBe(false);
    expect(matchSpoils(facts({ ratingAfter: 1210 })).empty).toBe(false);
  });
});
