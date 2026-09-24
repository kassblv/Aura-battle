# Poses jouables et cinq familles — plan d'implémentation (chantier n°1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** passer de 3 à 5 familles de contres (Calme, Hype, Provoc,
Acrobatie, Prouesse) et faire du choix de duel une **pose**, possédée et
vérifiée par le serveur, sans qu'aucune pose ne soit plus forte qu'une autre de
sa case.

**Architecture :** le moteur (`@aura/rules`) ne connaît que des mouvements
(famille + palier). Une pose est du contenu (`@aura/content`), qui sait à quel
mouvement elle appartient. Le protocole 2.0.0 transporte la pose, et le serveur
en déduit le mouvement et vérifie la possession. Le client envoie la pose
présélectionnée de la case.

**Tech Stack :** TypeScript strict ESM, pnpm + Turborepo, Vitest + fast-check,
zod, NestJS + Socket.IO, React + Three.js.

**Spec :** `docs/superpowers/specs/2026-09-24-poses-cinq-familles-design.md`

## Global Constraints

- Familles, dans cet ordre (c'est l'ordre du cercle) : `calme`, `hype`, `provoc`, `acrobatie`, `prouesse`.
- Contres : chaque famille bat la suivante et celle à trois crans sur ce cercle.
  - calme → hype, acrobatie
  - hype → provoc, prouesse
  - provoc → acrobatie, calme
  - acrobatie → prouesse, hype
  - prouesse → calme, provoc
- Icônes : calme 🧊, hype 🔥, provoc 😏, acrobatie 🤸, prouesse 💪.
- Multiplicateurs inchangés : `winnerMultiplier: 1.35`, `loserMultiplier: 0.85`. Paliers, énergie, amplificateurs, Ultime : inchangés.
- `PROTOCOL_VERSION = '2.0.0'`.
- Chaque case (famille × palier) a exactement une pose **gratuite**, qui est la première de sa liste dans `MOVE_ANIMATIONS`, avec `"rarity": "default"`. Aucune autre pose n'a la rareté `default`.
- Règles d'or de `CLAUDE.md` :
  - le serveur fait autorité ;
  - `packages/rules` reste pur (pas de `Date.now()`, pas de `Math.random()`) ;
  - rien du choix ne sort avant `round:result` ;
  - le contenu est de la donnée ;
  - tout équilibrage passe par `balance.ts`, avec un test et `docs/01`.
- Textes affichés en français. Code, commits et branches en anglais. Exception assumée : les identifiants de famille `acrobatie` et `prouesse`.
- Commits Conventional Commits, chacun terminé par `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Pièges du dépôt :
  - NestJS sous tsx : `@Inject(Token)` explicite sur chaque paramètre de constructeur ;
  - `pnpm typecheck --force` avant de conclure (le cache Turbo ment) ;
  - un test lourd porte son `timeout` explicite.

## Review Focus

1. **Pose d'un autre mouvement que celui annoncé.** Un client modifié envoie une `poseId` valide mais non possédée, ou qui n'est pas une pose de mouvement (`anim.system.none.victory`, un effet `fx.flames`). Attendu : verrouillage refusé, aucun effet sur la manche, compteur de suspicion du siège incrémenté. Testé en Task 4.
2. **Choix par défaut et fantômes.** Un siège qui ne verrouille pas, ou un fantôme enregistré en 3 styles, doit révéler la pose gratuite de sa case, jamais une chaîne vide ni une exception. Testé en Task 4.
3. **Ancien client 1.x.** Il reçoit `CLIENT_OUTDATED` à la connexion, pas une déconnexion muette au premier `choice:lock`. Testé en Task 3.
4. **Profil local à 3 styles.** Un profil enregistré avant le changement, avec `roundsByStyle` à 3 clés, ne doit pas afficher `NaN` ni planter. Testé en Task 1.
5. **Pose présélectionnée devenue invalide.** `loadout.dances` pointe encore vers une pose qui a changé de case (par exemple `anim.hype.t4.wheel`). Le client doit envoyer la pose gratuite de la case, jamais l'identifiant périmé. Testé en Task 5.

---

### Task 1 : Contenu — cinq familles, 25 cases, six poses nouvelles

**Files :**
- Modify : `packages/content/src/catalogue.ts` (type `Style`, `STYLES`, `MOVE_ANIMATIONS`, nouveau `moveOfAnimation`)
- Modify : `packages/content/src/naming.ts` (`STYLE_NAMES`, nouveau `styleIcon`)
- Modify : `packages/content/src/animation.ts:123` (le type `move.style` suit `Style`)
- Modify : `packages/content/schema/animation.schema.json:128` et `docs/content/animation.schema.json` (même endroit) : enum des styles
- Move + modify : `packages/content/animations/hype/jumpclap.json` → `acrobatie/jumpclap.json` ; `hype/wheel.json` → `acrobatie/wheel.json` ; `hype/spin.json` → `acrobatie/spin.json` ; `calme/backflip.json` → `acrobatie/backflip.json`
- Create : `packages/content/animations/acrobatie/roll.json`, `packages/content/animations/prouesse/{flex,pushups,plank,handstand,humanflag}.json`
- Modify : `packages/content/tools/prototype-source.ts:41` (type du style)
- Modify : `apps/mobile/src/app/profile.ts:25,98,128` (profil à 5 familles, tolérant aux anciens profils)
- Modify : `apps/server/prisma/seed.ts` (retirer les animations absentes du catalogue)
- Test : `packages/content/src/catalogue.test.ts`, `packages/content/src/naming.test.ts`, `packages/content/src/pricing.test.ts`, `apps/mobile/src/app/profile.test.ts`

**Interfaces :**
- Produit (utilisés par les Tasks 2 à 5) :
  - `type Style = 'calme' | 'hype' | 'provoc' | 'acrobatie' | 'prouesse'` ;
  - `STYLES: readonly Style[]` dans l'ordre du cercle ;
  - `moveOfAnimation(id: string): Move | null` ;
  - `styleIcon(style: Style): string`.

- [ ] **Step 1 : écrire les tests du catalogue (échouent)**

Ajouter dans `packages/content/src/catalogue.test.ts` :

```ts
import { animationPrice } from './pricing.js';
import {
  animationIdsFor,
  defaultAnimationFor,
  moveOfAnimation,
  STYLES,
  TIERS,
} from './catalogue.js';

describe('cinq familles', () => {
  it('dans l ordre du cercle', () => {
    expect(STYLES).toEqual(['calme', 'hype', 'provoc', 'acrobatie', 'prouesse']);
  });

  it('chaque case a exactement une pose gratuite, la premiere', () => {
    for (const style of STYLES) {
      for (const tier of TIERS) {
        const ids = animationIdsFor({ style, tier });
        expect(ids.length).toBeGreaterThan(0);
        expect(ids[0]).toBe(defaultAnimationFor({ style, tier }));
        const free = ids.filter((id) => animationPrice(id, 'default') === 0);
        expect(free).toEqual([ids[0]]);
      }
    }
  });

  it('retrouve le mouvement d une pose', () => {
    expect(moveOfAnimation('anim.acrobatie.t2.wheel')).toEqual({ style: 'acrobatie', tier: 2 });
    expect(moveOfAnimation('anim.prouesse.t0.flex')).toEqual({ style: 'prouesse', tier: 0 });
  });

  it('refuse ce qui n est pas une pose de mouvement', () => {
    expect(moveOfAnimation('anim.system.none.victory')).toBeNull();
    expect(moveOfAnimation('fx.flames')).toBeNull();
    expect(moveOfAnimation('anim.hype.t4.wheel')).toBeNull(); // ancien identifiant
    expect(moveOfAnimation('')).toBeNull();
  });
});
```

Dans `naming.test.ts` :

```ts
import { styleIcon, styleName } from './naming.js';
import { STYLES } from './catalogue.js';

it('nomme et illustre les cinq familles', () => {
  expect(STYLES.map((s) => styleName(s).fr)).toEqual([
    'Calme', 'Hype', 'Provoc', 'Acrobatie', 'Prouesse',
  ]);
  expect(STYLES.map(styleIcon)).toEqual(['🧊', '🔥', '😏', '🤸', '💪']);
});
```

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm --filter @aura/content test -- catalogue naming`
Attendu : FAIL (`moveOfAnimation` et `styleIcon` n'existent pas, `STYLES` a 3 entrées).

- [ ] **Step 3 : types, noms, icônes, index**

Dans `catalogue.ts` :

```ts
export type Style = 'calme' | 'hype' | 'provoc' | 'acrobatie' | 'prouesse';

export const MOVE_ANIMATIONS: Readonly<Record<Style, Readonly<Record<Tier, readonly string[]>>>> =
  Object.freeze({
    calme: {
      0: ['crossed', 'behind'],
      1: ['pocket', 'stride'],
      2: ['lookaway', 'crown'],
      3: ['meditate', 'moonwalk', 'slowkick'],
      4: ['levitate'],
    },
    hype: {
      0: ['dab'],
      1: ['sixseven', 'shoulders'],
      2: ['fist', 'floss', 'goal'],
      3: ['griddy'],
      4: ['boat'],
    },
    provoc: {
      0: ['shush', 'skyward'],
      1: ['point', 'tpose'],
      2: ['mewing', 'shrug', 'slowclap'],
      3: ['lfront', 'dust'],
      4: ['back', 'bow'],
    },
    acrobatie: {
      0: ['jumpclap'],
      1: ['roll'],
      2: ['wheel'],
      3: ['spin'],
      4: ['backflip'],
    },
    prouesse: {
      0: ['flex'],
      1: ['pushups'],
      2: ['plank'],
      3: ['handstand'],
      4: ['humanflag'],
    },
  });

/** L ordre du cercle des contres (docs/01 §2) : ne pas trier. */
export const STYLES: readonly Style[] = ['calme', 'hype', 'provoc', 'acrobatie', 'prouesse'];

/** Index inverse : identifiant complet d une pose → son mouvement. */
const MOVE_BY_ANIMATION: ReadonlyMap<string, Move> = new Map(
  STYLES.flatMap((style) =>
    TIERS.flatMap((tier) =>
      animationsFor({ style, tier }).map((slug) => [animationId({ style, tier }, slug), { style, tier }] as const),
    ),
  ),
);

/**
 * Le mouvement d une pose, ou `null` si ce n est pas une pose de mouvement.
 *
 * C est ce que le serveur lit au verrouillage : le client ne dit que la pose,
 * le mouvement s en deduit ici et nulle part ailleurs.
 */
export function moveOfAnimation(id: string): Move | null {
  return MOVE_BY_ANIMATION.get(id) ?? null;
}
```

Attention : `TIERS` et `animationsFor` doivent être déclarés **avant**
`MOVE_BY_ANIMATION`. Déplacer la constante `TIERS` au-dessus si nécessaire.

Dans `naming.ts` :

```ts
const STYLE_NAMES: Readonly<Record<Style, LocalizedName>> = {
  calme: { fr: 'Calme' },
  hype: { fr: 'Hype' },
  provoc: { fr: 'Provoc' },
  acrobatie: { fr: 'Acrobatie' },
  prouesse: { fr: 'Prouesse' },
};

const STYLE_ICONS: Readonly<Record<Style, string>> = {
  calme: '🧊',
  hype: '🔥',
  provoc: '😏',
  acrobatie: '🤸',
  prouesse: '💪',
};

/** L icone d une famille : une seule source, lue par tous les ecrans. */
export function styleIcon(style: Style): string {
  return STYLE_ICONS[style];
}
```

Exporter `styleIcon` et `moveOfAnimation` depuis `packages/content/src/index.ts`.
Enums JSON (`packages/content/schema/animation.schema.json:128` et
`docs/content/animation.schema.json`) :
`["calme", "hype", "provoc", "acrobatie", "prouesse", "system"]`.
`tools/prototype-source.ts:41` : importer le type `Style`.

- [ ] **Step 4 : déplacer les quatre poses de voltige**

```bash
cd packages/content/animations && mkdir -p acrobatie prouesse
git mv hype/jumpclap.json acrobatie/jumpclap.json
git mv hype/wheel.json acrobatie/wheel.json
git mv hype/spin.json acrobatie/spin.json
git mv calme/backflip.json acrobatie/backflip.json
```

Dans chacun des quatre fichiers, modifier `id`, `move` et `rarity` :

| Fichier | `id` | `move` | `rarity` |
|---|---|---|---|
| jumpclap | `anim.acrobatie.t0.jumpclap` | `{ "style": "acrobatie", "tier": 0 }` | `default` |
| wheel | `anim.acrobatie.t2.wheel` | `{ "style": "acrobatie", "tier": 2 }` | `default` |
| spin | `anim.acrobatie.t3.spin` | `{ "style": "acrobatie", "tier": 3 }` | `default` |
| backflip | `anim.acrobatie.t4.backflip` | `{ "style": "acrobatie", "tier": 4 }` | `default` |

Puis `grep -rn "anim.hype.t0.jumpclap\|anim.hype.t4.wheel\|anim.hype.t3.spin\|anim.calme.t4.backflip" packages apps docs --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md'`,
et remplacer chaque référence restante par le nouvel identifiant (vitrines,
tests, mèmes).

- [ ] **Step 5 : créer les six poses avec le skill `/add-dance`**

Suivre `.claude/skills/add-dance` pour chacune : format de
`docs/07-content-pipeline.md`, noms sans personne réelle, chanson ni marque. Au
moins 4 images clés, du mouvement secondaire, et une pose finale lisible de
loin, parce que c'est ce que l'adversaire voit à la révélation. Toutes en
`"rarity": "default"`.

| Fichier | `id` | Nom affiché | Palier | Intention |
|---|---|---|---|---|
| `acrobatie/roll.json` | `anim.acrobatie.t1.roll` | Roulade | 1 | roulade avant, se relève bras écartés |
| `prouesse/flex.json` | `anim.prouesse.t0.flex` | Biceps contractés | 0 | double biceps de face, menton levé |
| `prouesse/pushups.json` | `anim.prouesse.t1.pushups` | Pompes | 1 | deux pompes rapides, puis tête relevée vers l'adversaire |
| `prouesse/plank.json` | `anim.prouesse.t2.plank` | Planche | 2 | gainage immobile, puis claque au sol d'une main |
| `prouesse/handstand.json` | `anim.prouesse.t3.handstand` | Poirier | 3 | monte en équilibre sur les mains, jambes tendues |
| `prouesse/humanflag.json` | `anim.prouesse.t4.humanflag` | Drapeau humain | 4 | corps à l'horizontale, tenu à bout de bras |

Chaque fichier passe `pnpm --filter @aura/content validate` (ou la commande du
skill) et le contrôle de cadrage mobile (`apps/mobile/src/**/framing*.test.ts`).
Vérifier chaque pose à l'œil dans la galerie de l'accueil (`pnpm dev`).

- [ ] **Step 6 : profil local tolérant**

Test (`apps/mobile/src/app/profile.test.ts`) :

```ts
it('lit un profil enregistre avant les cinq familles', () => {
  const old = { ...emptyProfile(), roundsByStyle: { calme: 4, hype: 2, provoc: 2 } } as unknown as PlayerProfile;
  const shares = styleShares(old);
  expect(shares.map((share) => share.style)).toEqual(['calme', 'hype', 'provoc', 'acrobatie', 'prouesse']);
  expect(shares.every((share) => Number.isFinite(share.percent))).toBe(true);
  expect(shares.find((share) => share.style === 'acrobatie')?.percent).toBe(0);
});
```

Adapter les noms `emptyProfile` / `styleShares` à ceux de `profile.ts` (la
fonction des lignes 97-110 et celle qui rend le profil vide ligne 128). Dans
`profile.ts`, le profil vide passe à
`roundsByStyle: { calme: 0, hype: 0, provoc: 0, acrobatie: 0, prouesse: 0 }`,
et la lecture devient `profile.roundsByStyle[style] ?? 0`.

- [ ] **Step 7 : le seed retire les animations disparues**

Dans `apps/server/prisma/seed.ts`, après la boucle d'`upsert` de `seedCosmetics` :

```ts
// Une pose qui change de famille change d identifiant (`anim.hype.t4.wheel`
// devient `anim.acrobatie.t2.wheel`). L ancien reste en base avec son ancien
// prix : on le retire, ou la boutique continuerait de le vendre.
await prisma.cosmeticItem.deleteMany({
  where: { kind: 'ANIMATION', id: { notIn: allAnimationIds() } },
});
```

La suppression se propage en cascade aux `InventoryItem` (comptes de test
uniquement : aucun joueur réel au 2026-09-24).

- [ ] **Step 8 : tout faire passer**

Run : `pnpm --filter @aura/content test && pnpm typecheck --force`
Attendu : content vert. Le typecheck peut échouer dans les paquets qui indexent
un `Record<Style, …>` à 3 clés : les corriger ici **s'ils relèvent du
contenu** (mèmes, vestiaire, profil). Laisser `@aura/rules` à la Task 2.

- [ ] **Step 9 : commit**

```bash
git add -A packages/content docs/content apps/mobile/src/app/profile.ts apps/mobile/src/app/profile.test.ts apps/server/prisma/seed.ts
git commit -m "feat(content): five pose families with a free pose in every cell"
```

---

### Task 2 : Règles — la roue à cinq familles

**Files :**
- Modify : `packages/rules/src/types.ts:9-10`, `packages/rules/src/balance.ts:36,124-130`, `packages/rules/src/round.ts:102-103`
- Modify : `packages/rules/src/ai/profiles.ts:200-203`, `packages/rules/src/sim/skill.ts:60-63`, `packages/rules/src/sim/strategies.ts:63-66`
- Modify : `apps/mobile/src/app/MatchScreen.tsx:65-71,812,822` (l'icône et le « bat » lisent la liste)
- Test : `packages/rules/src/balance.test.ts:26-45`, `packages/rules/src/round.test.ts`

**Interfaces :**
- Consomme : `Style` à 5 valeurs (Task 1). `@aura/rules` redéclare son propre `Style`, identique ; ne pas importer `@aura/content` depuis `rules`.
- Produit :
  - `BALANCE.styleBeats: Readonly<Record<Style, readonly Style[]>>` ;
  - `beats(attacker: Style, defender: Style, config?: BalanceConfig): boolean`, exporté par `packages/rules/src/index.ts` ;
  - `beatersOf(style: Style, config?: BalanceConfig): readonly Style[]`, exporté aussi.

- [ ] **Step 1 : tests (échouent)**

Remplacer le bloc « styles et contres » de `balance.test.ts` :

```ts
import fc from 'fast-check';
import { BALANCE, beats, beatersOf } from './index.js';

describe('BALANCE — la roue des cinq familles (§2)', () => {
  it('garde les trois contres historiques', () => {
    expect(beats('calme', 'hype')).toBe(true);
    expect(beats('hype', 'provoc')).toBe(true);
    expect(beats('provoc', 'calme')).toBe(true);
  });

  it('pose les contres des deux nouvelles familles', () => {
    expect(BALANCE.styleBeats).toEqual({
      calme: ['hype', 'acrobatie'],
      hype: ['provoc', 'prouesse'],
      provoc: ['acrobatie', 'calme'],
      acrobatie: ['prouesse', 'hype'],
      prouesse: ['calme', 'provoc'],
    });
  });

  const style = fc.constantFrom(...BALANCE.styles);

  it('chaque famille en bat exactement deux et perd contre exactement deux', () => {
    fc.assert(
      fc.property(style, (s) => {
        expect(BALANCE.styleBeats[s]).toHaveLength(2);
        expect(beatersOf(s)).toHaveLength(2);
      }),
    );
  });

  it('aucune paire n est a la fois gagnante et perdante, personne ne se bat', () => {
    fc.assert(
      fc.property(style, style, (a, b) => {
        if (a === b) expect(beats(a, b)).toBe(false);
        else expect(beats(a, b) !== beats(b, a)).toBe(true);
      }),
    );
  });
});
```

Dans `round.test.ts`, ajouter :

```ts
it('applique le contre d une nouvelle famille', () => {
  // prouesse bat calme : meme palier, meme ampli, meme timing
  const result = resolveRound(inputsWith({ style: 'prouesse', tier: 2 }, { style: 'calme', tier: 2 }));
  expect(result.a.counter).toBe(true);
  expect(result.b.countered).toBe(true);
});
```

Adapter `inputsWith` au fabricant d'entrées que `round.test.ts` utilise déjà.
S'il n'existe pas, en écrire un qui construit deux `RoundSeatInput` identiques
à l'exception du mouvement.

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm --filter @aura/rules test -- balance round`
Attendu : FAIL (`beats` n'existe pas, `styleBeats` a 3 entrées).

- [ ] **Step 3 : implémenter**

`types.ts` : `export type Style = 'calme' | 'hype' | 'provoc' | 'acrobatie' | 'prouesse';`

`balance.ts` :

```ts
readonly styleBeats: Readonly<Record<Style, readonly Style[]>>;
// …
styles: ['calme', 'hype', 'provoc', 'acrobatie', 'prouesse'],
/*
  Le cercle : chaque famille bat la suivante et celle a trois crans. C est la
  seule roue a cinq ou chacune a le meme profil (deux victoires, deux
  defaites) — les multiplicateurs valent donc pour toutes les paires.
*/
styleBeats: {
  calme: ['hype', 'acrobatie'],
  hype: ['provoc', 'prouesse'],
  provoc: ['acrobatie', 'calme'],
  acrobatie: ['prouesse', 'hype'],
  prouesse: ['calme', 'provoc'],
},
```

Geler les listes internes comme le reste de `BALANCE`.

Nouveau fichier `packages/rules/src/counters.ts`, exporté depuis `index.ts` :

```ts
import { BALANCE, type BalanceConfig } from './balance.js';
import type { Style } from './types.js';

/** Vrai si `attacker` contre `defender`. */
export function beats(attacker: Style, defender: Style, config: BalanceConfig = BALANCE): boolean {
  return config.styleBeats[attacker].includes(defender);
}

/** Les familles qui battent `style`, dans l ordre du cercle. */
export function beatersOf(style: Style, config: BalanceConfig = BALANCE): readonly Style[] {
  return config.styles.filter((candidate) => beats(candidate, style, config));
}
```

`round.ts:102-103` :

```ts
const aBeatsB = beats(a.choice.move.style, b.choice.move.style, config);
const bBeatsA = beats(b.choice.move.style, a.choice.move.style, config);
```

Les trois `beaterOf` (`ai/profiles.ts`, `sim/skill.ts`, `sim/strategies.ts`)
deviennent « l'un des deux, tiré par le RNG qu'ils ont déjà sous la main ». Le
moteur reste déterministe :

```ts
function beaterOf(style: Style, rng: Rng, config: BalanceConfig): Style {
  return rng.pick(beatersOf(style, config));
}
```

Passer `context.rng` à chaque appel (lignes `profiles.ts:315`,
`skill.ts:109`, `strategies.ts:104`). Si un site d'appel n'a pas de RNG,
prendre `beatersOf(style, config)[0]` et le commenter.

`MatchScreen.tsx` : supprimer `STYLE_ICONS` et `FALLBACK_ICON`, importer
`styleIcon` de `@aura/content` et `BALANCE` de `@aura/rules`, puis :

```tsx
aria-label={`${styleName(id).fr}, bat ${BALANCE.styleBeats[id].map((s) => styleName(s).fr).join(' et ')}`}
// …
<span className="pick__icon">{styleIcon(id)}</span>
// …
<small>bat {BALANCE.styleBeats[id].map(styleIcon).join('')}</small>
```

- [ ] **Step 4 : tests verts, puis simulation**

Run : `pnpm --filter @aura/rules test && pnpm typecheck --force`
Puis : `pnpm sim --matches 10000 --strategy all`
Attendu :
- tests verts ;
- taux de victoire par famille entre 47 et 53 % (`docs/09-testing.md:384`) ;
- les autres seuils de `docs/09` respectés.

Si un seuil saute, **s'arrêter et remonter les chiffres** : ne pas retoucher
les multiplicateurs sans validation (règle d'or n°6).

- [ ] **Step 5 : commit**

```bash
git add packages/rules apps/mobile/src/app/MatchScreen.tsx
git commit -m "feat(rules): five-family counter wheel"
```

---

### Task 3 : Protocole 2.0.0 — le choix désigne une pose

**Files :**
- Modify : `packages/protocol/src/primitives.ts:13` (`styleSchema` tiré de `BALANCE.styles`)
- Modify : `packages/protocol/src/client.ts:111-129` (`choice:lock` : `poseId` au lieu de `move`)
- Modify : `packages/protocol/src/version.ts:32` (`2.0.0` + note)
- Test : `packages/protocol/src/client.test.ts`, `packages/protocol/src/version.test.ts`, `apps/server/src/modules/auth/application/socket-auth.test.ts`

**Interfaces :**
- Produit : `ClientMessage<'choice:lock'>` = `{ matchId, round, seq, poseId: string, amp, ult, timing }`.

- [ ] **Step 1 : tests (échouent)**

`client.test.ts` :

```ts
const lock = {
  matchId: 'm_1', round: 1, seq: 1,
  poseId: 'anim.acrobatie.t2.wheel', amp: 0, ult: false,
  timing: { chargeAt: 0, tapAt: 500 },
};

it('choice:lock porte une pose', () => {
  expect(CLIENT_MESSAGES['choice:lock'].safeParse(lock).success).toBe(true);
});

it('choice:lock refuse l ancien champ move', () => {
  const old = { ...lock, move: { style: 'calme', tier: 0 } };
  expect(CLIENT_MESSAGES['choice:lock'].safeParse(old).success).toBe(false);
});

it('choice:lock refuse une pose mal formee', () => {
  expect(CLIENT_MESSAGES['choice:lock'].safeParse({ ...lock, poseId: 'ANIM:X' }).success).toBe(false);
});

it('intent:show accepte les nouvelles familles', () => {
  const intent = { matchId: 'm_1', round: 1, seq: 2, style: 'prouesse' };
  expect(CLIENT_MESSAGES['intent:show'].safeParse(intent).success).toBe(true);
});
```

`version.test.ts` :

```ts
it('2.0.0 refuse un client 1.x', () => {
  expect(PROTOCOL_VERSION).toBe('2.0.0');
  expect(isCompatibleProtocol('1.3.0')).toBe(false);
  expect(isCompatibleProtocol('2.0.0')).toBe(true);
});
```

Côté serveur, dans le test de `socket-auth`, vérifier qu'une poignée de main
en `protocolVersion: '1.3.0'` renvoie l'erreur `CLIENT_OUTDATED` (Review Focus n°3).

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm --filter @aura/protocol test`
Attendu : FAIL.

- [ ] **Step 3 : implémenter**

`primitives.ts` :

```ts
/** Les familles viennent du moteur : en ajouter une n ouvre qu un seul fichier. */
export const styleSchema = z.enum(BALANCE.styles as [Style, ...Style[]]);
```

(importer `type Style` de `@aura/rules`).

`client.ts`, dans `choice:lock` : remplacer `move: moveSchema,` par

```ts
/**
 * La pose jouee. Le client ne dit que CA : famille et palier s en deduisent
 * cote serveur (`moveOfAnimation`), qui verifie aussi la possession. Envoyer
 * les deux laisserait un client mentir sur l un ou l autre.
 */
poseId: contentIdSchema,
```

Retirer l'import devenu inutile de `moveSchema` si besoin : il reste utilisé par
`server.ts`.

`version.ts` : ajouter la note puis `export const PROTOCOL_VERSION = '2.0.0';` :

```ts
/*
  2.0.0 — le choix designe une POSE.

  `choice:lock.move` est remplace par `poseId`, et les familles passent de
  trois a cinq. Un client 1.x enverrait un champ que le serveur refuse : il est
  renvoye sur l ecran de mise a jour des la connexion (`CLIENT_OUTDATED`)
  plutot que de perdre chaque verrouillage en silence.
*/
```

- [ ] **Step 4 : tests verts**

Run : `pnpm --filter @aura/protocol test`
Attendu : PASS. `pnpm typecheck --force` échoue maintenant dans
`apps/server` (gateway) et `apps/mobile` (`online.ts`) : c'est attendu, et ce
sont les Tasks 4 et 5. **Ne pas commiter avant la Task 5** si l'on veut une
branche verte à chaque commit. Sinon, commiter maintenant et enchaîner sans
pousser.

- [ ] **Step 5 : commit**

```bash
git add packages/protocol apps/server/src/modules/auth
git commit -m "feat(protocol)!: choice:lock names a pose, five families (2.0.0)"
```

---

### Task 4 : Serveur — pose verrouillée, possession vérifiée, révélée

**Files :**
- Modify : `apps/server/src/modules/match/adapters/match.gateway.ts:720-742`
- Modify : `apps/server/src/modules/match/application/match-runtime.ts` : `lockChoice` (694), `cosmeticOf` (842-853), `LiveMatch` (134), `SeatWearing` (88-108), `refreshDances` (371-386, supprimée)
- Modify : `apps/server/src/modules/match/application/wearing.ts` (plus de `dances`, plus d'appel à `refreshDances`)
- Modify : `apps/server/src/modules/matchmaking/adapters/prisma-ghost.store.ts:32` (enum → `styleSchema`)
- Modify : `apps/server/bench/player.ts:80,438` (le banc de charge envoie une pose)
- Test : `apps/server/src/modules/match/application/match-runtime.test.ts`, `apps/server/src/modules/match/adapters/match-e2e.test.ts`, `apps/server/src/modules/match/application/wearing.test.ts`

**Interfaces :**
- Consomme : `moveOfAnimation`, `defaultAnimationFor` (Task 1) ; `ClientMessage<'choice:lock'>.poseId` (Task 3).
- Produit : `MatchRuntime.lockChoice(matchId: string, seat: Seat, choice: Choice, timingTapAtMs: number | null, poseId: string | null): void`. Ici `null` veut dire « pas de pose » (fantôme, bot), et la révélation montre la pose gratuite de la case.
- `SeatWearing` : `dances` retiré, `owned: readonly string[]` ajouté (tout ce qui est possédé, objets offerts compris ; c'est la liste que `wearingFrom` reçoit déjà).

- [ ] **Step 1 : tests e2e (échouent)**

Dans `match-e2e.test.ts`, en suivant le harnais du fichier (clients Socket.IO de
test, journal `onAny` posé dès la connexion, **identifiants de joueur
distincts par scénario**) :

```ts
it('revele la pose verrouillee, avec le mouvement deduit', async () => {
  // A verrouille la roue (gratuite, acrobatie t2), B la biceps (gratuite, prouesse t0)
  const result = await playOneRound(a, b, {
    a: { poseId: 'anim.acrobatie.t2.wheel', amp: 0 },
    b: { poseId: 'anim.prouesse.t0.flex', amp: 0 },
  });
  expect(result.sides.a.move).toEqual({ style: 'acrobatie', tier: 2 });
  expect(result.sides.a.cosmetic.animationId).toBe('anim.acrobatie.t2.wheel');
  expect(result.sides.b.cosmetic.animationId).toBe('anim.prouesse.t0.flex');
  // acrobatie bat prouesse
  expect(result.sides.a.counter).toBe(true);
});

it('refuse une pose payante non possedee', async () => {
  const result = await playOneRound(a, b, {
    a: { poseId: 'anim.calme.t0.behind', amp: 0 }, // payante, jamais achetee
    b: { poseId: 'anim.hype.t0.dab', amp: 0 },
  });
  // Le verrouillage de A est ignore : A joue le choix par defaut du moteur.
  expect(result.sides.a.cosmetic.animationId).not.toBe('anim.calme.t0.behind');
  expect(result.sides.a.timing.quality).toBe('miss');
});

it.each(['anim.system.none.victory', 'fx.flames', 'anim.hype.t4.wheel'])(
  'refuse %s, qui n est pas une pose de mouvement',
  async (poseId) => {
    const result = await playOneRound(a, b, { a: { poseId, amp: 0 }, b: { poseId: 'anim.hype.t0.dab', amp: 0 } });
    expect(result.sides.a.timing.quality).toBe('miss');
  },
);

it('revele la pose gratuite de la case pour un siege qui n a pas verrouille', async () => {
  const result = await playOneRound(a, b, { a: null, b: { poseId: 'anim.hype.t0.dab', amp: 0 } });
  const move = result.sides.a.move;
  expect(result.sides.a.cosmetic.animationId).toBe(defaultAnimationFor(move));
});

it('ne laisse rien filtrer de la pose avant round:result', async () => {
  const logB = recordAll(b); // onAny des la connexion
  await playOneRound(a, b, { a: { poseId: 'anim.acrobatie.t2.wheel', amp: 0 }, b: { poseId: 'anim.hype.t0.dab', amp: 0 } });
  const beforeResult = logB.until('round:result');
  expect(JSON.stringify(beforeResult)).not.toContain('acrobatie');
  expect(JSON.stringify(beforeResult)).not.toContain('wheel');
});
```

`playOneRound` et `recordAll` sont à écrire dans le fichier s'ils n'existent
pas, à partir des aides de match déjà présentes. `playOneRound` tape au moins
un orbe par siège, pour qu'aucun forfait pour inactivité ne se déclenche.

Pour « pose non possédée », vérifier que le compteur de suspicion **du siège
A seulement** augmente, par la même lecture que les tests existants de
`impossibleTaps`.

Dans `wearing.test.ts`, remplacer les attentes sur `dances` par :
`wearingFrom(owned, loadout, kinds).owned` égale `owned`.

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm --filter server test -- match-e2e wearing match-runtime`
Attendu : FAIL de compilation ou d'assertion.

- [ ] **Step 3 : implémenter**

`match.gateway.ts` : `choiceLock` résout la pose avant d'appeler le runtime.

```ts
const move = moveOfAnimation(body.poseId);
if (move === null) {
  // Pas une pose de mouvement : un client honnete ne l envoie jamais.
  this.runtime.flagSuspicious(body.matchId, seat, 'UNKNOWN_POSE');
  return;
}
this.runtime.lockChoice(
  body.matchId,
  seat,
  { move, amplifier: body.amp, useUltimate: body.ult },
  timingTapAtMs,
  body.poseId,
);
```

Si `flagSuspicious` n'existe pas, utiliser le compteur par siège que le runtime
tient déjà pour les incohérences (même mécanisme que `impossibleTaps`), sans
jamais de compteur commun aux deux sièges (`CLAUDE.md`, anti-triche).

`match-runtime.ts` :
- `SeatWearing` : retirer `dances`, ajouter `readonly owned: readonly string[];`.
- `LiveMatch` : ajouter `poses: Record<Seat, string | null>;`, initialisé à
  `{ a: null, b: null }`, et remis à `null` pour les deux sièges à chaque
  entrée en phase `choice`, au même endroit que la remise à zéro de `pending`.
- `lockChoice(matchId, seat, choice, timingTapAtMs, poseId)` : si
  `poseId !== null && !match.wearing[seat].owned.includes(poseId)`, alors
  incrémenter le compteur de suspicion du siège et `return` **avant**
  `this.apply`. Après un `apply` accepté (le code compare déjà `before` et
  l'état), `match.poses[seat] = poseId`.
- `cosmeticOf` :

```ts
return {
  animationId: match.poses[seat] ?? defaultAnimationFor(move),
  effectId: effectForLevel(amplifier, wearing.ownedEffects).id,
};
```

- Supprimer `refreshDances` et son appel dans `wearing.ts:132`, ainsi que le
  commentaire de `socket-notifier.ts:54` qui y renvoie.
- `wearing.ts` : `wearingFrom` rend `{ ownedEffects: owned, owned, look }`. La
  boucle des `dances` disparaît : la présélection vit dans le loadout, lue par
  le client, et le module `match` n'en a plus besoin.
- Les appels internes à `lockChoice` (fantômes, bots, tests) passent `null`.

`prisma-ghost.store.ts:32` : `style: styleSchema` (importé de `@aura/protocol`).
Les enregistrements en trois styles restent valides.

`bench/player.ts` : remplacer le tirage de style par un tirage parmi les poses
gratuites, par exemple
`STYLES.map((s) => defaultAnimationFor({ style: s, tier }))`, et envoyer
`poseId`.

- [ ] **Step 4 : tests verts**

Run : `pnpm --filter server test && pnpm typecheck --force`
Attendu : serveur vert. Mobile encore rouge, c'est la Task 5.

- [ ] **Step 5 : commit**

```bash
git add apps/server
git commit -m "feat(match): lock a pose, check it is owned, reveal it"
```

---

### Task 5 : Client — envoyer la pose présélectionnée

**Files :**
- Modify : `apps/mobile/src/app/MatchScreen.tsx:81-96` (`MatchActions.lock`) et `lockIn` (409-417)
- Modify : `apps/mobile/src/match/online.ts:95,320-331`
- Modify : `apps/mobile/src/app/useOnlineMatch.ts` (adaptateur `actions.lock`), `apps/mobile/src/app/useMatch.ts` (solo : ignore `poseId`)
- Modify : `apps/mobile/src/app/wardrobe.ts:239-251` (`danceOptions` ne rend jamais un identifiant hors de la case)
- Test : `apps/mobile/src/match/online.test.ts`, `apps/mobile/src/app/wardrobe.test.ts`

**Interfaces :**
- Consomme : `ClientMessage<'choice:lock'>` (Task 3), `defaultAnimationFor` (Task 1).
- Produit :
  - `MatchActions.lock(choice: Choice, chargeAtMs: number, tapAtMs: number, poseId: string): boolean` ;
  - `OnlineMatch.lock(choice: Choice, poseId: string, chargeAtMs: number, tapAtMs: number | null): void`.

- [ ] **Step 1 : tests (échouent)**

`online.test.ts`, dans « envois du joueur » :

```ts
it('verrouille en envoyant la pose, pas le mouvement', () => {
  const { match, emit, sent } = harness();
  emit('choice:start', { /* charge utile d un choice:start existant dans ce fichier */ });
  match.lock(
    { move: { style: 'acrobatie', tier: 2 }, amplifier: 0, useUltimate: false },
    'anim.acrobatie.t2.wheel',
    100,
    700,
  );
  const lock = sent.find((m) => m.name === 'choice:lock')?.payload as Record<string, unknown>;
  expect(lock.poseId).toBe('anim.acrobatie.t2.wheel');
  expect(lock).not.toHaveProperty('move');
});
```

`wardrobe.test.ts` (Review Focus n°5) :

```ts
it('ne presente jamais une pose presélectionnee qui a change de case', () => {
  const wardrobe = wardrobeWith({ dances: { 'hype.t4': 'anim.hype.t4.wheel' } });
  const view = danceOptions(wardrobe, { style: 'hype', tier: 4 });
  expect(view.current).toBe('anim.hype.t4.boat');
});
```

`wardrobeWith` : utiliser le fabricant du fichier de test. S'il n'existe pas,
construire un `Wardrobe` minimal avec `owned: new Set()` et un `look` qui porte
cette table de danses.

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm --filter mobile test -- online wardrobe`

- [ ] **Step 3 : implémenter**

`online.ts`, signature et envoi :

```ts
lock(choice: Choice, poseId: string, chargeAtMs: number, tapAtMs: number | null): void;
// …
lock(choice, poseId, chargeAtMs, tapAtMs) {
  if (state.matchId === null) return;
  client.send('choice:lock', {
    matchId: state.matchId,
    round: state.round,
    seq: seq++,
    poseId,
    amp: choice.amplifier,
    ult: choice.useUltimate,
    timing: { chargeAt: chargeAtMs, tapAt: tapAtMs },
  });
},
```

`MatchScreen.tsx` : `MatchActions.lock` prend `poseId` en dernier. Dans
`lockIn` :

```ts
const move = { style, tier };
// La pose presélectionnee de la case, sinon la gratuite : jamais une chaine
// vide, que le serveur refuserait en silence.
const poseId = danceView?.current || defaultAnimationFor(move);
if (actions.lock(choice, chargeAt.current, at, poseId)) setLocked(true);
```

`useOnlineMatch.ts` : `lock: (choice, chargeAtMs, tapAtMs, poseId) =>
matchRef.current?.lock(choice, poseId, chargeAtMs, tapAtMs)`. Garder le
`useCallback` existant : l'identité stable protège la mémoïsation de
`ControlBand`.

`useMatch.ts` (solo) : accepter le quatrième paramètre et l'ignorer. Le solo
joue déjà la pose présélectionnée via `danceFor`.

`wardrobe.ts` : `danceOptions` vérifie déjà que la pose équipée est dans
`choices`, filtrés par style et palier. Si le test de l'étape 1 passe tel quel,
ne rien changer et le noter dans le message de commit.

- [ ] **Step 4 : tout vert**

Run : `pnpm lint && pnpm typecheck --force && pnpm test --force`
Attendu : tout vert, avec les comptes par paquet.

- [ ] **Step 5 : commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): lock the preselected pose of the cell"
```

---

### Task 6 : Docs, règle d'or, relecture, duel réel

**Files :**
- Modify : `docs/01-game-design.md` (§1 « style » → « famille », §2 réécrit : roue, 25 cases, tableau des poses, règle « de côté »), `docs/03-pvp-protocol.md` (`choice:lock.poseId`, 2.0.0, refus `UNKNOWN_POSE` / non possédée), `docs/07-content-pipeline.md` (six poses nouvelles, quatre déplacées), `docs/08-roadmap.md` (jalon coché + chantiers 2 à 5 listés)
- Modify : `CLAUDE.md`, règle d'or n°3
- Create : `docs/adr/0014-poses-de-cote-jamais-au-dessus.md`
- Create : `docs/balance/2026-09-24-cinq-familles.md` (sortie de `pnpm sim`)

- [ ] **Step 1 : règle d'or n°3 dans `CLAUDE.md`**

Remplacer la ligne 3 des règles d'or par :

```markdown
3. **Des poses de côté, jamais au-dessus.** Tout ce qui modifie un score s'obtient en jouant ; l'argent ne fait que raccourcir l'attente. Une pose achetable n'est jamais plus forte que la pose gratuite de sa case, et chaque case en a une (ADR 0014). La boutique vend du temps et du style, jamais de la puissance.
```

- [ ] **Step 2 : ADR 0014**

Court, sur le modèle des ADR existants : contexte (3 styles trop pauvres,
poses payantes non jouables), décision (5 familles, pose = famille + palier,
une gratuite par case, protocole 2.0.0), conséquences (6 animations,
`loadout.dances` devenue présélection, fantômes en 3 styles encore valides,
pas de remboursement faute de joueurs réels).

- [ ] **Step 3 : docs 01, 03, 07, 08, et rapport de simulation**

Recopier les chiffres réels de `pnpm sim --matches 10000 --strategy all` dans
`docs/balance/2026-09-24-cinq-familles.md`, sans arrondir à l'avantage.

- [ ] **Step 4 : relecture sécurité**

Déléguer à l'agent `security-reviewer` : `packages/protocol`, le module
`apps/server/src/modules/match`, `match.gateway.ts`, sur les commits des
Tasks 3 et 4. Traiter tout point BLOQUANT avant de conclure.

- [ ] **Step 5 : duel réel à deux navigateurs**

`pnpm dev`, deux contextes isolés, duel par code :
- A verrouille une pose d'Acrobatie, B une de Prouesse ;
- des deux côtés, vérifier le nom de la pose jouée à la révélation, l'animation qui correspond et le contre correct (Acrobatie bat Prouesse) ;
- faire les captures dans une frame d'animation, page au premier plan (sinon `requestAnimationFrame` ne tourne pas).

- [ ] **Step 6 : vérification finale et commit**

Run : `pnpm lint && pnpm typecheck --force && pnpm test --force`

```bash
git add CLAUDE.md docs
git commit -m "docs: five families, playable poses, golden rule 3 rewritten"
```
