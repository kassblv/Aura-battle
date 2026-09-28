# 2026-09-16 — Mesure initiale (aucun ajustement)

Première exécution de `pnpm sim` sur les valeurs d'origine de `balance.ts`. Aucun changement
d'équilibrage n'a été fait : ce document sert de point de comparaison pour les suivants.

Commande : `pnpm --filter @aura/rules run sim --matches 2000 --seed verification`

## Résultats

| Mesure | Valeur | Zone saine (`docs/09`) | |
|---|---|---|---|
| Style le plus faible (calme) | 48,8 % | 47–53 % | ok |
| Style le plus fort (hype) | 50,7 % | 47–53 % | ok |
| Meilleure stratégie contre l'aléatoire | 73,8 % | ≤ 80 % | ok |
| Tout sur une manche contre économe | **6,3 %** | 40–60 % | **hors zone** |
| Manches nulles | 0,0 % | ≤ 3 % | ok |
| Matchs en trois manches | 52,4 % | 30–55 % | ok |
| Avantage d'un bon timeur (60 % vs 20 % de parfaits) | 65,9 % | 60–75 % | ok |

Taux de victoire par stratégie : aléatoire 51,5 %, glouton 80,5 %, contre-picker 56,3 %,
économe 45,1 %, tout-sur-une-manche 16,6 %.

Taux de victoire par palier : 11,9 % / 23,3 % / 34,0 % / 45,7 % / 67,4 %.

## Le cycle des styles est sain

48,8 / 50,7 / 50,5 %. Attendu, puisque le cycle est symétrique et qu'aucun style n'a de
puissance propre — c'est néanmoins la confirmation que la résolution des contres n'introduit
pas de biais.

## La mesure hors zone n'est pas un défaut de code

Expérience complémentaire, 3 000 matchs par ligne, énergie concentrée sur les N premières
manches contre la stratégie économe :

| Énergie concentrée sur | Taux de victoire |
|---|---|
| 1 manche | 3,8 % |
| 2 manches | 95,3 % |
| 3 manches | 95,4 % |

C'est une falaise, pas une pente. **Il faut gagner deux manches** : une stratégie qui n'en
conteste qu'une est structurellement perdante, quelles que soient les valeurs de
`balance.ts`. Le seuil « 40–60 % » de `docs/09` demande donc une mesure inatteignable sous
les règles actuelles.

## Le vrai problème : l'énergie ne crée presque aucune décision

14 points d'énergie, plafond de 8 par manche, deux manches à gagner. Donc **8 + 6 = 14**
dépense l'intégralité de la réserve en exactement deux manches, ce qui est précisément ce
qu'il faut pour gagner. Économiser pour la belle revient à parier qu'on y arrivera — or on
peut être éliminé avant. D'où : glouton 80,5 %, économe 45,1 %.

`docs/00-vision.md` présente l'énergie comme l'un des quatre piliers du cœur de jeu, aux
côtés des contres, du bluff et du timing. Aujourd'hui ce pilier est creux : « dépense tôt et
à fond » domine sans contrepartie.

### Pistes, par ordre d'intrusivité croissante

1. **Ne rien changer.** Assumer que la dépense précoce est forte et que la contre-play passe
   par les contres et le timing. L'énergie devient alors un rythme, pas une décision.
2. **Abaisser le plafond par manche** de 8 à 6. `6 + 6 = 12` laisse 2 points orphelins : il
   faut alors arbitrer entre trois manches, et la belle redevient finançable.
3. **Récompenser la réserve.** Donner un bonus de score à l'énergie non dépensée en fin de
   match, ou convertir l'énergie restante en jauge d'Ultime.
4. **Réduire l'énergie de départ** de 14 à 12 : deux manches à 8 deviennent impossibles.

Aucune de ces pistes n'est appliquée. Elles demandent une décision de game design, puis une
mise à jour de `docs/01-game-design.md` et un nouveau rapport avant/après.
