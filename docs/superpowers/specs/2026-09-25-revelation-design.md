# La révélation — chantier n°3

Date : 2026-09-25 · Statut : décidé sur recommandation (le joueur : « je te fais
confiance sur les recommandations », « ne t'arrête pas tant que tu n'as pas
fini ») ; relisible après coup.

## Pourquoi

La révélation est le sommet de chaque manche. L'arène joue déjà son rythme :

| Instant | Événement |
|---|---|
| 120 ms | premier combattant révélé |
| 820 ms | second combattant révélé |
| 1 550 ms | choc des auras |
| ≈ 2 500 ms | verdict |

Mais **l'interface ne raconte rien**. Au choc, le joueur ne lit ni la pose que
l'adversaire a jouée, ni *pourquoi* elle gagne. Le contre, cœur stratégique du
jeu, se devine au lieu de se voir. La carte brillante ✨ jouée ne s'annonce
qu'au verdict.

## Ce qu'on ajoute

1. **Les cartes révélées.** Chaque combattant a sa carte, avec le même visuel que
   la main : pictogramme, nom de la pose, famille, palier.
   - Elle apparaît dans le coin haut de son côté, **à l'instant où ce combattant
     se révèle** (ordre de `timeline.revealFirst`).
   - La carte adverse arrive **face cachée** « ? », puis **se retourne**.
2. **Le bandeau du contre**, au centre, **à l'instant du choc** :
   - « 🤸 BAT 💪 · ×1,35 » quand un contre s'applique, écrit du point de vue du
     vainqueur du contre ;
   - « MIROIR » quand les deux jouent la même famille ;
   - « 🛡️ CONTRE BLOQUÉ » quand l'Ultime annule un contre.
3. **La brillante éclate** : une carte révélée qui était brillante arrive avec
   une gerbe dorée et « ✨ ×1,2 ».
4. **Son et vibration.** Le retournement de la carte adverse a son « flip », le
   bandeau du contre claque avec le son du choc, et la brillante tinte.

## Règles d'or

- Rien de nouveau ne part du serveur. Tout est déjà dans `round:result` :
  mouvements, `cosmetic.animationId`, `counter`, `countered`, `counterBlocked`,
  `shiny` et `timeline.revealFirst`. La règle d'or n°4 tient par construction.
- Tout passe par le compositeur (`transform`, `opacity`), et le mouvement
  réduit est respecté.
- Les cartes vivent dans les coins hauts, loin des combattants. Le bandeau
  passe au centre, au-dessus du choc.

## Architecture

- **`RoundView`** (`match/view.ts`) porte enfin ce que l'arène devinait :
  - `myMove`, `opponentMove` ;
  - `opponentPoseId` : la pose adverse, en ligne ; en solo, la pose offerte ;
  - `counteredBy` : `'moi' | 'adversaire' | null` ;
  - `counterBlocked` ;
  - `revealFirst` ;
  - `opponentUltimate`, `opponentQuality`.

  `storyOfRound` lit ces champs au lieu de ses replis : le choc de l'arène
  devient exact.
- **`app/reveal.ts`**, un module pur et testé : `revealScene(lastRound,
  wardrobe)` rend les deux cartes (ma pose, sa présélection, sinon l'offerte),
  l'ordre et l'instant de chacune, et le bandeau (`counter`, `mirror`,
  `blocked`), avec ses familles et son multiplicateur.
- **`app/RevealStage.tsx`** : monté pendant la révélation. Ce n'est pas l'instant
  critique du choix : la bande de commandes vient de disparaître. Les instants
  passent par des délais CSS (`--at`), calés sur les constantes de
  `arena/round.ts`.

## Critères d'acceptation

- [x] `reveal.ts` testé :
  - contre par moi et par l'adversaire ;
  - miroir ;
  - contre bloqué ;
  - ordre de révélation ;
  - brillante ;
  - pose adverse connue ou offerte.
- [x] La vue en ligne et la vue solo portent les nouveaux champs (tests), et
  `storyOfRound` les lit (test).
- [x] Rendu : deux cartes, dont une face cachée qui se retourne, et un bandeau
  (test de rendu statique).
- [x] À l'écran : capture d'une révélation avec contre et d'un miroir.
- [x] lint, typecheck et tests verts ; relecture finale.
