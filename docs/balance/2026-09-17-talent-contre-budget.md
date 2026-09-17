# 2026-09-17 — Faire primer le talent sur le budget

**Décision : compresser les multiplicateurs d'amplificateur** de `{1,00 · 1,25 · 1,50 · 1,80 · 2,20}`
à `{1,00 · 1,12 · 1,25 · 1,40 · 1,55}`. Un seul champ de `balance.ts` change.

Intention produit à l'origine de ce changement : *« le talent et la réflexion priment »*.
Le rapport du 16/09 (`2026-09-16-mesure-initiale.md`) montrait l'énergie sans décision ;
celui-ci montre pourquoi c'était pire que ça — le talent ne suffisait pas à la compenser.

## Le diagnostic

Tout le talent réuni — contre gagné et timing parfait — vaut un multiplicateur fixe :

```
×1,35 (contre) × ×1,50 (parfait) = ×2,03
```

L'écart de budget, lui, va du mouvement gratuit au palier 4 amplifié au maximum :

```
56 × 2,20 / 11 = ×11,20
```

**Le budget pesait 5,5 fois plus que tout le talent disponible.** Aucune adresse ne rattrape
cet écart ; c'est arithmétique, pas statistique.

## Pourquoi c'est l'amplificateur, et lui seul

Le palier **sature à un coût de 4**. Deux joueurs qui dépensent 8 et 4 jouent donc tous les
deux au palier 4 : la totalité de l'écart de budget passe par l'amplificateur. C'est lui qui
décide de ce que vaut l'énergie excédentaire.

Une intuition contraire a été testée puis écartée : comprimer les **paliers** au lieu des
amplificateurs. Le résultat est l'inverse de l'effet recherché — voir le tableau ci-dessous,
ligne « paliers comprimés seuls » : le talent tombe à 38,9 %. Comprimer les paliers rend le
palier moins attractif, donc reporte encore plus de budget sur l'amplificateur.

## Mesures

`pnpm sim` mesure désormais quatre duels où une seule variable diffère entre les deux sièges
(voir `docs/09-testing.md`, section « Mesure du skill »). 4 000 matchs par duel, graine
`talent-vs-budget`, sondes alternées de siège à mi-parcours.

| Variante | Timing | Lecture | Budget | **Talent contre budget** |
|---|---|---|---|---|
| Avant | 72,8 % | 62,2 % | 83,7 % | **47,3 %** |
| Paliers comprimés seuls | 72,9 % | 62,1 % | 87,6 % | **38,9 %** |
| **Après (retenu)** | 72,8 % | 62,2 % | **65,5 %** | **69,5 %** |

Témoin (deux sondes identiques) : 51,4 % dans les trois variantes. L'écart au 50 % théorique
donne l'ordre de grandeur du bruit — environ ±1,5 point. Les écarts commentés ici sont d'un
ordre de grandeur au-dessus.

**Avant le changement, le joueur qui lisait son adversaire et visait juste avec la moitié du
budget perdait** (47,3 %). Après, il gagne (69,5 %). Le timing et la lecture ne bougent pas :
ces duels se jouent à budget égal, l'amplificateur n'y change rien. C'est la preuve que la
mesure lit bien une variable à la fois.

| Amplitude | Avant | Après |
|---|---|---|
| Écart de budget maximal | ×11,20 | ×7,89 |
| Plafond du talent | ×2,03 | ×2,03 |
| Rapport | **5,5** | **3,9** |

## Vérification au tournoi

8 000 matchs, graine `sim`. Aucun seuil de `docs/09` ne se dégrade.

| Mesure | Avant | Après |
|---|---|---|
| Styles (faible / fort) | 49,6 % / 50,7 % | 49,7 % / 50,6 % |
| Glouton | 79,3 % | **72,3 %** |
| Contre-picker | 57,6 % | **64,1 %** |
| Économe | 46,4 % | 46,7 % |
| Tout sur une manche | 15,3 % | 14,8 % |
| Manches nulles | 0,0 % | 0,0 % |
| Avantage d'un bon timeur | 66,5 % | 68,4 % |

Le glouton — « brûler tout, tout de suite » — perd 7 points ; le contre-picker — « lire
l'adversaire » — en gagne 6,5. C'est exactement l'échange voulu.

## Ce que ce changement ne corrige pas

- **« Tout sur une manche contre économe » reste hors zone** (3,1 %, attendu 40–60 %). Le
  rapport du 16/09 a établi que ce seuil est **structurellement inatteignable** : il faut
  gagner deux manches, donc une stratégie qui n'en conteste qu'une est perdante quelles que
  soient les valeurs. Le seuil de `docs/09` demande une mesure impossible ; c'est le seuil
  qu'il faudra revoir, pas l'équilibrage.
- **L'amplificateur reste dominé par le palier à coût égal.** 4 points d'énergie dans le
  palier valent ×5,09, les mêmes 4 points dans l'amplificateur ×1,55. L'amplificateur n'est
  donc jamais un vrai choix : c'est une éponge à budget excédentaire. Ce changement aggrave
  ce déséquilibre — assumé, parce que c'est précisément ce qui fait baisser la valeur de
  l'énergie excédentaire. Rendre l'amplificateur *intéressant* est une autre question de
  design, à traiter séparément (par exemple en lui donnant un effet qui ne soit pas un
  multiplicateur de score).
- **Le problème du 16/09 reste entier** : l'énergie ne crée toujours presque aucune décision,
  puisque `8 + 6 = 14` dépense toute la réserve en exactement deux manches. Ce changement
  réduit ce que l'énergie *rapporte*, pas le fait qu'il n'y ait rien à en décider.

## Traces

- `packages/rules/src/balance.ts` — `amplifierMultiplier`.
- `packages/rules/src/balance.test.ts` — le test qui fixe le rapport : `amplifierMultiplier[4]`
  doit rester **sous** `×1,35 × ×1,50`. Sans lui, la valeur pourrait remonter sans que rien
  ne le signale.
- `packages/rules/src/sim/skill.ts` + `skill.test.ts` — les duels, et le seuil
  « talent contre budget » (55–85 %) désormais vérifié par `pnpm sim`.
- `docs/01-game-design.md` — table des amplificateurs.
- `docs/09-testing.md` — seuil et méthode.
