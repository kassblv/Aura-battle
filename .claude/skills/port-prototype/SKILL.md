---
name: port-prototype
description: Guide pour extraire du prototype HTML (prototype/aura-battle.html) les données et le code à porter dans le monorepo (animations en JSON, rendu 3D, audio, IA solo). À utiliser dès qu'une tâche consiste à reprendre quelque chose du prototype.
---

# Porter du prototype vers le monorepo

Le prototype est un seul fichier. Ne le modifie jamais. Repère les sections par leurs commentaires `/* ===... */` et `/* ---... */` avec Grep, puis lis seulement la section utile.

## Où se trouve quoi

| Élément                           | Section du prototype                                                      | Destination                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Styles, contres, constantes       | « Styles et contres »                                                     | `packages/rules/src/balance.ts` (valeurs à reprendre depuis `docs/01-game-design.md`, qui fait foi) |
| Poses et prix                     | « Données » (`POSES`, `ANIMS`, `COLORS`, `HAIRS`, `OUTFITS`, `OPPONENTS`) | `packages/content` (cosmétiques) et `packages/rules/src/ai` (profils d'IA)                          |
| Squelettes et animations          | « Squelettes » (`PTS`, `APOSE`, `HAND_SHAPES`, `POSE_HANDS`)              | `packages/content/animations/*.json`                                                                |
| Interpolation, ressorts, mains    | « Squelette fluide », « Personnages 3D » (`buildHand`, `updateHand`)      | `apps/mobile/src/animation` et `apps/mobile/src/arena/rig`, `arena/hands`                           |
| Scène, foule, projecteurs         | « Construction de la scène »                                              | `apps/mobile/src/arena/stage`, `arena/crowd`                                                        |
| Particules et effets              | « Particules d'aura », « Effets globaux », `fillParticles`                | `apps/mobile/src/arena/particles`                                                                   |
| Choc et caméra                    | « Choc des auras », « Caméra »                                            | `arena/clash`, `arena/camera`                                                                       |
| Textes flottants, bandeaux, orbes | « Calque 2D », « Phase de recharge » (`drawRecharge`)                     | `arena/overlay`                                                                                     |
| Sons et musique                   | « Sons (générés en direct) »                                              | `apps/mobile/src/audio`                                                                             |

## Port des animations (argument `animations`)

Pour chaque entrée de `APOSE`, et pour chaque entrée de `PTS` absente de `APOSE` (poses fixes comme `charge`, `stagger`, `land`) :

1. Crée `packages/content/animations/<style>/<id>.json` conforme à `docs/content/animation.schema.json`.
2. `id` : `anim.<style>.t<palier>.<slug>`, avec le palier donné par la table « Animations par défaut » de `docs/01-game-design.md`. Poses système : `anim.system.none.<slug>`.
3. Chaque image clé `K({...})` devient une entrée `frames` : complète les articulations manquantes avec les valeurs de `S0` du prototype ; déplace `z`, `lift`, `rot`, `hy`, `pitch` dans leurs champs.
4. Pose fixe : une seule image, `loop.duration` = 4.
5. `dur` → `loop.duration`, `w` → `loop.weights`, `ease` → `loop.ease`.
6. `armsFront`, `armsBack`, `noFace`, `float` → `flags` ; `smug`, `sad`, `angry`, `hurt` → `flags.expression`.
7. `POSE_HANDS[id]` → `hands` (défaut `[["relax","in"],["relax","in"]]`) ; `emit` tel quel.
8. `name.fr` reprend le nom de `POSES` ; signale dans ton résumé les noms listés dans « Noms et droits » de `docs/07-content-pipeline.md`.
9. Lance le validateur et corrige jusqu'à 0 erreur.
10. Ajoute un test qui charge chaque animation et vérifie qu'à `t = 0` les positions correspondent au prototype (tolérance 0,01).

## Port du rendu

- Transforme les globales du prototype en classes ou fonctions avec dépendances explicites (scène, horloge, configuration de qualité).
- Remplace les coordonnées « pixels logiques » (`toX3`, `toY3`) par des positions 3D directes fournies par l'état du match.
- Conserve les valeurs visuelles (couleurs, tailles, durées) dans un fichier de thème.
