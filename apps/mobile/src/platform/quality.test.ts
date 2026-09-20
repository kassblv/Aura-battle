import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AURA_BUDGET } from '../arena/aura.js';
import { ADDITIVE_CAPACITY, DARK_CAPACITY } from '../arena/particles.js';
import { CROWD_SIZE } from '../arena/crowdLayout.js';
import { MAX_PIXEL_RATIO } from '../arena/renderer.js';
import {
  MAX_CREDIBLE_FRAME_MS,
  QUALITY_PROFILES,
  QUALITY_TIERS,
  SAMPLE_FRAMES,
  SLOW_FRAME_MS,
  SLOW_FRAME_SHARE,
  createQualityGovernor,
  effectivePixelRatio,
  type QualityGovernor,
  type QualitySetting,
} from './quality.js';

/** Combien d images de `ms` il faut pour remplir une fenetre de mesure. */
function feed(governor: QualityGovernor, ms: number, frames = SAMPLE_FRAMES): void {
  for (let i = 0; i < frames; i++) governor.record(ms);
}

/** 60 i/s. */
const FAST_MS = 1000 / 60;
/** 25 i/s : sous le plancher de 30 i/s, donc toutes les images sont lentes. */
const SLOW_MS = 40;

describe('table des paliers', () => {
  /*
    Le piege le plus cher de ce depot : une valeur reexprimee ailleurs ne se
    voit ni au compilateur, ni aux tests, ni en relecture. La table est la
    source, les constantes de l arene en decoulent — ce test le verifie dans
    les deux sens a la fois.
  */
  it('le palier le plus haut est ce que l arene dessine aujourd hui', () => {
    expect(QUALITY_PROFILES.rich.pixelRatioCap).toBe(MAX_PIXEL_RATIO);
    expect(QUALITY_PROFILES.rich.crowdSeats).toBe(CROWD_SIZE);
    expect(QUALITY_PROFILES.rich.additiveParticles).toBe(ADDITIVE_CAPACITY);
    expect(QUALITY_PROFILES.rich.darkParticles).toBe(DARK_CAPACITY);
    expect(QUALITY_PROFILES.rich.auraParticles).toBe(AURA_BUDGET);
    expect(QUALITY_PROFILES.rich.hands).toBe(true);
  });

  it('va du plus cher au moins cher, sans palier qui remonte', () => {
    expect(QUALITY_TIERS).toEqual(['rich', 'balanced', 'smooth']);
    const profiles = QUALITY_TIERS.map((tier) => QUALITY_PROFILES[tier]);
    for (let i = 1; i < profiles.length; i++) {
      const previous = profiles[i - 1]!;
      const current = profiles[i]!;
      expect(current.pixelRatioCap).toBeLessThanOrEqual(previous.pixelRatioCap);
      expect(current.crowdSeats).toBeLessThanOrEqual(previous.crowdSeats);
      expect(current.additiveParticles).toBeLessThanOrEqual(previous.additiveParticles);
      expect(current.darkParticles).toBeLessThanOrEqual(previous.darkParticles);
      expect(current.auraParticles).toBeLessThanOrEqual(previous.auraParticles);
    }
  });

  /*
    Le premier cercle est la couche proche qui donne sa profondeur a l arene.
    Un palier qui descend sous sa taille effacerait le public du premier plan
    et laisserait les gradins du fond : exactement l inverse de ce qu on veut
    voir disparaitre.
  */
  /*
    Deux auras a fond doivent tenir dans le tampon additif, qui porte aussi le
    choc et ses eclats. Un budget d aura superieur a la moitie du tampon ferait
    tronquer l un des deux combattants par ordre d arrivee — et on paierait
    quand meme la simulation des particules jetees.
  */
  it('laisse les deux auras tenir dans le tampon additif', () => {
    for (const tier of QUALITY_TIERS) {
      const profile = QUALITY_PROFILES[tier];
      expect(profile.auraParticles * 2).toBeLessThan(profile.additiveParticles);
    }
  });

  it('aucun palier ne descend sous le premier cercle', () => {
    for (const tier of QUALITY_TIERS) {
      expect(QUALITY_PROFILES[tier].crowdSeats).toBeGreaterThanOrEqual(18);
    }
  });
});

describe('gouverneur, mesure', () => {
  it('demarre au palier le plus haut, en automatique', () => {
    const governor = createQualityGovernor();
    expect(governor.setting).toBe('auto');
    expect(governor.tier).toBe('rich');
    expect(governor.profile).toEqual(QUALITY_PROFILES.rich);
  });

  it('reprend le palier trouve a la session precedente', () => {
    expect(createQualityGovernor({ start: 'balanced' }).tier).toBe('balanced');
  });

  it('ne descend pas quand les images tiennent le budget', () => {
    const governor = createQualityGovernor();
    feed(governor, FAST_MS, SAMPLE_FRAMES * 4);
    expect(governor.pending).toBe('rich');
    expect(governor.commit()).toBe(false);
    expect(governor.tier).toBe('rich');
  });

  it('prepare une descente quand trop d images depassent le plancher', () => {
    const governor = createQualityGovernor();
    feed(governor, SLOW_MS);
    expect(governor.pending).toBe('balanced');
  });

  /*
    La question de conception de ce module : une bascule pendant la jauge
    deplace le sol sous les pieds du joueur au moment ou son timing est
    mesure. La descente attend donc la frontiere de manche.
  */
  it('n applique rien tant que la manche n est pas finie', () => {
    const governor = createQualityGovernor();
    feed(governor, SLOW_MS);
    expect(governor.tier).toBe('rich');
    expect(governor.profile).toEqual(QUALITY_PROFILES.rich);
    expect(governor.commit()).toBe(true);
    expect(governor.tier).toBe('balanced');
    expect(governor.profile).toEqual(QUALITY_PROFILES.balanced);
  });

  it('ne descend que d un palier a la fois', () => {
    const governor = createQualityGovernor();
    feed(governor, 200, SAMPLE_FRAMES);
    governor.commit();
    expect(governor.tier).toBe('balanced');
  });

  it('s arrete au palier le plus bas', () => {
    const governor = createQualityGovernor({ start: 'smooth' });
    feed(governor, SLOW_MS);
    expect(governor.pending).toBe('smooth');
    expect(governor.commit()).toBe(false);
  });

  it('ne remonte jamais tout seul', () => {
    const governor = createQualityGovernor({ start: 'smooth' });
    feed(governor, FAST_MS, SAMPLE_FRAMES * 4);
    expect(governor.pending).toBe('smooth');
    expect(governor.commit()).toBe(false);
    expect(governor.tier).toBe('smooth');
  });

  it('juge sur une fenetre pleine, pas sur les premieres images', () => {
    const governor = createQualityGovernor();
    feed(governor, SLOW_MS, SAMPLE_FRAMES - 1);
    expect(governor.pending).toBe('rich');
    governor.record(SLOW_MS);
    expect(governor.pending).toBe('balanced');
  });

  it('tolere quelques images lentes sous le seuil de part', () => {
    const governor = createQualityGovernor();
    const slow = Math.floor(SAMPLE_FRAMES * SLOW_FRAME_SHARE) - 1;
    for (let i = 0; i < SAMPLE_FRAMES; i++) {
      governor.record(i < slow ? SLOW_MS : FAST_MS);
    }
    expect(governor.pending).toBe('rich');
  });

  /*
    L app peut etre suspendue en plein match : au reveil, `performance.now()`
    rend une image de plusieurs secondes. Elle ne dit rien de la carte
    graphique, et la compter ferait chuter la qualite de quelqu un qui a
    simplement repondu a un message.
  */
  it('ignore une image invraisemblable, et oublie la fenetre en cours', () => {
    const governor = createQualityGovernor();
    feed(governor, SLOW_MS, SAMPLE_FRAMES - 1);
    governor.record(MAX_CREDIBLE_FRAME_MS + 1);
    feed(governor, FAST_MS, SAMPLE_FRAMES);
    expect(governor.pending).toBe('rich');
  });

  it('une image juste sous le plancher compte comme lente', () => {
    const governor = createQualityGovernor();
    feed(governor, SLOW_FRAME_MS + 0.5);
    expect(governor.pending).toBe('balanced');
  });

  it('une image juste au-dessus du plancher ne compte pas', () => {
    const governor = createQualityGovernor();
    feed(governor, SLOW_FRAME_MS - 0.5, SAMPLE_FRAMES * 2);
    expect(governor.pending).toBe('rich');
  });
});

describe('gouverneur, reglage manuel', () => {
  it('applique tout de suite le palier demande', () => {
    const governor = createQualityGovernor();
    governor.select('smooth');
    expect(governor.setting).toBe('smooth');
    expect(governor.tier).toBe('smooth');
    expect(governor.profile).toEqual(QUALITY_PROFILES.smooth);
  });

  it('laisse remonter a la main ce que l automatique a descendu', () => {
    const governor = createQualityGovernor();
    feed(governor, SLOW_MS);
    governor.commit();
    expect(governor.tier).toBe('balanced');
    governor.select('rich');
    expect(governor.tier).toBe('rich');
  });

  it('ne redescend plus tant que le joueur a choisi', () => {
    const governor = createQualityGovernor();
    governor.select('rich');
    feed(governor, SLOW_MS, SAMPLE_FRAMES * 4);
    expect(governor.pending).toBe('rich');
    expect(governor.commit()).toBe(false);
    expect(governor.tier).toBe('rich');
  });

  it('rend la main a l automatique depuis le palier courant', () => {
    const governor = createQualityGovernor();
    governor.select('rich');
    governor.select('auto');
    expect(governor.setting).toBe('auto');
    feed(governor, SLOW_MS);
    expect(governor.pending).toBe('balanced');
  });

  /*
    Revenir en automatique juste apres une fenetre lente ne doit pas appliquer
    un verdict rendu pendant que le joueur avait la main.
  */
  it('repart sur une fenetre vierge en revenant a l automatique', () => {
    const governor = createQualityGovernor();
    governor.select('rich');
    feed(governor, SLOW_MS);
    governor.select('auto');
    expect(governor.pending).toBe('rich');
  });
});

describe('gouverneur, proprietes', () => {
  const actions = fc.array(
    fc.oneof(
      fc.double({ min: 1, max: 400, noNaN: true }).map((ms) => ({ kind: 'record', ms }) as const),
      fc.constant({ kind: 'commit' } as const),
    ),
    { maxLength: 2000 },
  );

  it('sans intervention du joueur, la qualite ne remonte jamais', () => {
    fc.assert(
      fc.property(actions, (script) => {
        const governor = createQualityGovernor();
        let applied = 0;
        for (const action of script) {
          if (action.kind === 'record') governor.record(action.ms);
          else governor.commit();
          const index = QUALITY_TIERS.indexOf(governor.tier);
          expect(index).toBeGreaterThanOrEqual(applied);
          applied = index;
        }
      }),
    );
  });

  it('mesurer ne change rien : seul `commit` applique', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 1, max: 400, noNaN: true })), (deltas) => {
        const governor = createQualityGovernor();
        for (const ms of deltas) {
          governor.record(ms);
          expect(governor.tier).toBe('rich');
        }
      }),
    );
  });

  it('un palier choisi a la main est toujours celui qui est applique', () => {
    const settings = fc.constantFrom<QualitySetting>('rich', 'balanced', 'smooth');
    fc.assert(
      fc.property(settings, actions, (setting, script) => {
        const governor = createQualityGovernor();
        governor.select(setting);
        for (const action of script) {
          if (action.kind === 'record') governor.record(action.ms);
          else governor.commit();
        }
        expect(governor.tier).toBe(setting);
      }),
    );
  });
});

describe('effectivePixelRatio', () => {
  /*
    Une seule valeur pour deux consommateurs.

    Le rendu dessine dans un tampon de `css x ratio` pixels physiques, et la
    taille d une particule est exprimee en pixels **de ce tampon**. Donner le
    rapport brut a l un et le rapport plafonne a l autre grossit toutes les
    particules d autant : sur un telephone a 3x plafonne a 1,75, elles sont
    une fois et demie trop grosses. C est cette fonction qui empeche les deux
    appelants de diverger.
  */
  it('plafonne le rapport de l ecran', () => {
    expect(effectivePixelRatio(3, 1.75)).toBe(1.75);
    expect(effectivePixelRatio(2.625, 1)).toBe(1);
  });

  it('laisse passer un ecran moins dense que le plafond', () => {
    expect(effectivePixelRatio(1, 1.75)).toBe(1);
    expect(effectivePixelRatio(1.5, 1.75)).toBe(1.5);
  });

  /* Hors navigateur, `devicePixelRatio` peut etre absent, nul ou absurde. */
  it('retombe sur 1 quand l ecran ne dit rien de sense', () => {
    expect(effectivePixelRatio(0, 1.75)).toBe(1);
    expect(effectivePixelRatio(Number.NaN, 1.75)).toBe(1);
    expect(effectivePixelRatio(-2, 1.75)).toBe(1);
    expect(effectivePixelRatio(Number.POSITIVE_INFINITY, 1.75)).toBe(1.75);
  });
});
