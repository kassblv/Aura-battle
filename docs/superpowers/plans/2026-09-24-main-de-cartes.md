# La main de cartes — plan d'implémentation (chantier n°2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** remplacer l'écran de choix abstrait par une main de cartes de pose en éventail, avec un pictogramme par pose, des variantes empilées, une carte brillante ✨ tirée à chaque manche (×1,2) et un retour visuel, sonore et haptique sur chaque geste.

**Architecture :**
- **Le pictogramme** est de la donnée : champ `icon` dans le JSON de chaque pose.
- **La carte brillante** est une règle du moteur. Elle est tirée dans `RoundContext`, appliquée dans `resolveRound` et envoyée au seul siège concerné.
- **La main** est un module pur (`app/hand.ts`), affiché par un composant monté une fois pour tout le match (`app/PoseHand.tsx`).

**Tech Stack :** TypeScript ESM, Vitest + fast-check, zod, NestJS, React + CSS (compositeur), Capacitor Haptics.

**Spec :** `docs/superpowers/specs/2026-09-24-main-de-cartes-design.md`

## Global Constraints

- Écran 844×390 : rien ne défile, cibles tactiles ≥ 46 px (ADR 0008), rien ne coupe les combattants.
- Carte brillante : `BALANCE.shiny.multiplier = 1.2`. Tirage uniforme sur les 25 cases par `deriveSeed(seed, 'shiny', round, seat)`. `shinyAppetite: 0.35` pour l'IA.
- Protocole **2.1.0** (ajouts compatibles) :
  - `choice:start.shiny: { style, tier }`, pour le destinataire seulement ;
  - `round:result.sides.*.shiny: boolean`.
- `icon` obligatoire pour toute animation de mouvement ; aucun doublon au sein d'une famille ; les 39 valeurs viennent de la table de la spec §4.
- Effets par `transform` et `opacity` uniquement, `prefers-reduced-motion` respecté, aucun re-rendu React par image pendant le choix.
- Styles préfixés par bloc (`hand__…`) ; `styles.test.ts` vert.
- Règles d'or de `CLAUDE.md`. Commits Conventional Commits terminés par `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Case brillante inabordable** (palier 4 avec 3 d'énergie) : la carte brille mais reste grisée, et le reflet ne doit pas faire croire qu'elle est jouable. Testé en Task 5 (`affordable` et `shiny` ensemble).
2. **Famille brillante différente de l'onglet ouvert** : le joueur doit savoir qu'une brillante l'attend ailleurs. L'onglet porte l'étincelle. Testé en Task 5 (`tabsFor`).
3. **Reconnexion en pleine phase de choix** : `match:state` ne porte pas la brillante. Après une reprise, le joueur la perd de vue, mais le serveur l'applique quand même. Accepté et documenté pour ce chantier ; la reprise ne rejoue pas `choice:start`. Testé en Task 3 (la brillante est appliquée même sans `choice:start` vu).
4. **Retourner une carte pendant l'armement de la jauge** : changer de variante dans la même case ne doit ni réarmer ni décaler la jauge. Testé en Task 6 (même mouvement, donc même `chargeAt`).
5. **Mouvement réduit** : aucune rotation ni secousse, et les étapes restent lisibles. Couvert par la règle globale `prefers-reduced-motion` et vérifié en Task 7.

---

### Task 1 : Pictogramme par pose (contenu)

**Files :** `packages/content/schema/animation.schema.json`, `docs/content/animation.schema.json`, `packages/content/src/animation.ts` (`icon?: string`, requis pour une animation de mouvement dans `loadAnimation`/validate), les 39 JSON de `packages/content/animations/{calme,hype,provoc,acrobatie,prouesse}/`, test `packages/content/src/catalogue.test.ts`.

**Produces :** `Animation.icon: string | undefined`, et un helper `poseIcon(id: string): string` exporté par `@aura/content`, qui renvoie `styleIcon` de la famille en repli.

- [ ] Test (rouge) : chaque pose de mouvement a un `icon` non vide, les icônes sont uniques par famille, `poseIcon('anim.provoc.t2.mewing') === '🗿'`.
- [ ] Schéma : `"icon": { "type": "string", "minLength": 1, "maxLength": 16 }`. Le validateur exige `icon` quand `move.style !== 'system'`. Les deux copies du schéma restent identiques.
- [ ] Écrire les 39 valeurs de la spec §4 dans les JSON, par script, sans toucher aux images clés.
- [ ] `poseIcon` : un index construit au chargement du catalogue d'animations. Il doit lire les JSON sans I/O au runtime : suivre la façon dont les animations sont déjà exposées au client (`apps/mobile/src/content/animations.ts`) et au paquet content (`animations.test.ts`). Si le paquet content ne charge pas les JSON au runtime, placer `poseIcon` côté mobile (`apps/mobile/src/content/animations.ts`) et le noter au registre.
- [ ] Vert, puis commit `feat(content): an icon for every pose`.

### Task 2 : La carte brillante (moteur)

**Files :** `packages/rules/src/balance.ts`, `match.ts` (`RoundContext.shiny`, `buildRoundContext`, `resolveCurrentRound`), `round.ts` (`RoundSeatInput.shiny`, `RoundSeatOutcome.shiny`), `ai/profiles.ts` (`shinyAppetite`), `sim/*`, tests, `docs/01-game-design.md`, `docs/balance/`.

**Produces :**
- `BALANCE.shiny: { multiplier: 1.2 }` ;
- `RoundContext.shiny: Readonly<Record<Seat, Move>>` ;
- `RoundSeatInput.shiny: Move | null` ;
- `RoundSeatOutcome.shiny: boolean` ;
- `AiChoiceContext.shiny?: Move`.

- [ ] Tests (rouges) :
  - le score d'un siège qui joue exactement sa case brillante vaut ×1,2 (arrondi compris), et rien ne change pour une autre case ;
  - `outcome.shiny` vaut vrai seulement dans ce cas ;
  - propriété fast-check : `buildRoundContext` est déterministe par (graine, manche) ;
  - le tirage couvre les 25 cases, avec une fréquence de chacune entre 2 et 6 % sur 5 000 graines ;
  - les deux sièges ont des tirages indépendants (graines différentes).
- [ ] Implémentation :
  - dans `buildRoundContext`, `shiny: { a: pick(seat 'a'), b: pick(seat 'b') }`, où `pick` tire `style` puis `tier` d'un même `createRng(deriveSeed(seed, 'shiny', round, seat))` ;
  - dans `resolveRound`, le facteur `(isShiny ? config.shiny.multiplier : 1)` s'applique à `base` avec les autres facteurs ;
  - `isShiny` = même famille et même palier.
- [ ] IA : si `context.shiny` est définie, abordable, et que `rng.chance(profile.shinyAppetite ?? 0.35)`, jouer la case brillante. Sinon, comportement actuel.
- [ ] Simulation : les stratégies reçoivent la brillante. Ajouter une stratégie `shinyChaser` (joue toujours sa brillante si abordable). Lancer `pnpm sim --matches 10000 --strategy all` : seuils de `docs/09` tenus, et `shinyChaser` ≤ `counter`. Rapport `docs/balance/2026-09-24-carte-brillante.md`.
- [ ] `docs/01` : nouvelle section « Carte brillante » (valeur, tirage, secret jusqu'à `round:result`).
- [ ] Vert, puis commit `feat(rules): a shiny cell per seat and round, ×1.2`.

### Task 3 : Protocole 2.1.0 et serveur

**Files :** `packages/protocol/src/server.ts` (`choice:start.shiny`, `roundSideSchema.shiny`), `version.ts`, tests ; `apps/server/src/modules/match/application/views.ts` (`choiceStartFor`), `match-runtime.ts` (`sideFor`), tests.

**Consumes :** `RoundContext.shiny` et `RoundSeatOutcome.shiny` (Task 2).

- [ ] Tests (rouges) :
  - le schéma accepte `choice:start` avec `shiny` et `round:result` avec `sides.*.shiny` ;
  - `choiceStartFor('a', state)` porte `state.roundContext.shiny.a` et jamais la case de `b` (test de vue sur deux sièges aux cases différentes) ;
  - `round:result` porte `shiny` repris de l'outcome ;
  - la brillante est appliquée même si le client n'a jamais vu `choice:start` (Review Focus n°3).
- [ ] Implémentation, puis `PROTOCOL_VERSION = '2.1.0'` avec sa note.
- [ ] Vert, puis commit `feat(protocol): the shiny cell travels to its owner only (2.1.0)`.

### Task 4 : Vue client (en ligne et solo)

**Files :** `apps/mobile/src/match/online.ts` (`OnlineState.shiny`), `match/view.ts` (`SideView.shiny: Move | null` pour `me`, toujours `null` pour l'adversaire ; `RoundView.myShiny: boolean`, `opponentShiny: boolean`), tests.

- [ ] Tests (rouges) :
  - `choice:start` avec `shiny` remplit `view.me.shiny` ;
  - la vue solo lit `roundContext.shiny.a` ;
  - `view.opponent.shiny` vaut toujours `null` ;
  - `lastRound.myShiny` et `opponentShiny` sont repris de `round:result` ou de l'historique solo.
- [ ] Implémentation. Mettre aussi à jour la clé de rendu (`renderKey`), sinon l'écran ne se redessinerait pas à l'arrivée de la brillante.
- [ ] Vert, puis commit `feat(mobile): the view knows my shiny cell`.

### Task 5 : La main, module pur

**Files :** créer `apps/mobile/src/app/hand.ts` et `hand.test.ts`.

**Produces :**

```ts
export interface HandCard {
  readonly tier: Tier;
  readonly poseId: string;
  readonly icon: string;
  readonly name: string;
  readonly power: number;
  readonly cost: number;
  readonly affordable: boolean;
  readonly shiny: boolean;
  readonly variants: { readonly index: number; readonly owned: number; readonly toUnlock: number };
}
export interface HandInput {
  readonly family: Style;
  readonly wardrobe: Wardrobe;
  readonly budget: number;          // énergie jouable cette manche (cap du panneau)
  readonly amplifierCost: number;   // coût de l'amplificateur choisi
  readonly shiny: Move | null;
}
export function handFor(input: HandInput): readonly HandCard[];
export function nextVariant(card: HandCard, wardrobe: Wardrobe, move: Move): string;
export interface FamilyTab { readonly family: Style; readonly icon: string; readonly beats: readonly Style[]; readonly shiny: boolean }
export function tabsFor(shiny: Move | null): readonly FamilyTab[];
```

- [ ] Tests (rouges) :
  - 5 cartes, paliers 0 à 4 dans l'ordre ;
  - pose = présélection valide de la case, sinon l'offerte (réutiliser `danceOptions`) ;
  - `variants.owned` et `toUnlock` justes ;
  - `nextVariant` boucle sur les possédées ;
  - `affordable = tierCost + amplifierCost <= budget` ;
  - `shiny` sur la seule bonne carte, même quand elle est inabordable (Review Focus n°1) ;
  - `tabsFor` marque l'onglet de la famille brillante (Review Focus n°2) ;
  - `beats` vient de `BALANCE.styleBeats`.
- [ ] Implémentation pure : `@aura/content` pour noms et icônes, `@aura/rules` pour puissance et coût.
- [ ] Vert, puis commit `feat(mobile): the hand of pose cards as pure data`.

### Task 6 : L'écran — `PoseHand` et la bande de commandes

**Files :** créer `apps/mobile/src/app/PoseHand.tsx`. Modifier :
- `app/MatchScreen.tsx`, `ControlBand` : retirer la grappe « Style », l'échelle de paliers et la danse ; ajouter `PoseHand` ; placer l'Ultime et la jauge à gauche, l'amplificateur en colonne à droite ;
- `src/styles.css` : blocs `hand__*` et nouvelle disposition de la bande ;
- `ui/layout.ts` : retirer `STYLE_COLUMNS` s'il n'est plus lu ;
- `app/styles.test.ts` : doit rester vert.

- [ ] Test (rouge), en rendu statique (`react-dom/server`, comme les autres tests d'écran s'il en existe ; sinon un test de la fonction de classes). Il vérifie que :
  - la main produit 5 éléments `button.hand__card` et 5 `button.hand__tab` ;
  - la carte brillante porte `data-shiny="true"` ;
  - une carte inabordable porte `data-poor="true"` et reste un bouton actif.
- [ ] Gestes :
  - `onTab(family)` ;
  - `onCard(card)` : si c'est déjà la carte choisie et qu'elle a plus d'une variante, alors `onVariant(nextVariant(...))` ; sinon choisir `{ style: family, tier }` ;
  - Review Focus n°4 : même case, donc ni réarmement ni nouveau `chargeAt` ;
  - l'aperçu reste local.
- [ ] Mémoïsation : `PoseHand` reçoit des primitives et des callbacks stables, comme `ControlBand`, et est monté une seule fois pour tout le match.
- [ ] Vert (dont `styles.test.ts` : classes et 46 px), puis commit `feat(mobile): the hand of pose cards replaces the style and tier buttons`.

### Task 7 : Le ressenti et la caméra

**Files :**
- `src/styles.css` : distribution, soulèvement, retournement, tremblement, écrasement, reflet, avec `@media (prefers-reduced-motion: reduce)` ;
- `audio/cues.ts` : les repères `cardDeal`, `cardPick`, `cardFlip`, `cardDenied`, `lockSlam`, `shinyDeal`, et les sons associés tirés des sons existants ;
- `platform/haptics.ts` (`hapticFor`) ;
- `arena/camera.ts` (cadrage de la phase de choix) ;
- tests correspondants.

- [ ] Tests (rouges) :
  - `hapticFor('cardPick') === 'light'`, `hapticFor('lockSlam') === 'medium'` ;
  - `soundForCue` rend un son pour chaque nouveau repère ;
  - le cadrage de choix a un `lookY` plus haut que le cadrage de repos, d'une valeur mesurée : pieds des combattants au-dessus du haut de la main (y ≤ 390 − 172 px).
- [ ] CSS :
  - animations par `transform` et `opacity` ;
  - distribution : `animation-delay: calc(var(--i) * 45ms)` ;
  - l'écrasement du verrouillage est déclenché par `data-locked`.
- [ ] Vérifier dans le navigateur, en 844×390, en solo et en duel réel : captures de la main, de la brillante et du verrouillage ; la main ne coupe pas les combattants ; rien ne défile.
- [ ] Vert, puis commit `feat(mobile): cards that deal, lift, flip and slam, with sound and touch`.

### Task 8 : Documentation, relectures, mise en ligne de la branche

- [ ] `docs/08` : chantier n°2 coché. `docs/03` : 2.1.0. `docs/07` : `icon` obligatoire.
- [ ] `security-reviewer` : `choice:start` par siège, `round:result`, et aucune fuite de la brillante.
- [ ] Relecture finale de la branche (modèle le plus capable), corrections Important et Critique.
- [ ] `pnpm lint && pnpm typecheck --force && pnpm test --force`, puis push et commentaire sur la PR #1.
