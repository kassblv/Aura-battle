# Carte brillante — mesure du 2026-09-24

Une case tirée au sort par joueur et par manche ; la jouer multiplie le score par ×1,2 (docs/01, « Carte brillante »). Nouvelle stratégie de référence : `shinyChaser`, qui joue sa brillante chaque fois qu'elle est abordable.

Commande : `pnpm sim --matches 10000 --strategy all` (graine « sim »).

## Ce qu'il fallait vérifier

1. Que la chance ne domine pas la lecture : `shinyChaser` doit rester sous `counter`.
2. Que les familles restent équilibrées et que les seuils de `docs/09` tiennent.

## Résultat

| Mesure | Avant (cinq familles, sans brillante) | Avec la brillante | Zone saine |
|---|---|---|---|
| Famille la plus faible / forte | 49,5 % / 50,6 % | 49,7 % / 50,2 % | 47–53 % |
| Contre-picker | 65,0 % | 67,3 % | — |
| **Chasseur de brillantes** | — | **40,0 %** | < contre-picker |
| Avantage d'un bon timeur | 68,9 % | 68,9 % | 60–75 % |
| Talent contre budget | 70,1 % | 70,6 % | 55–85 % |
| Tout sur une manche contre économe | 3,0 % | 2,5 % | 40–60 % (hors zone depuis le 16/09) |

Attention : ces 40 % ne mesurent **pas** la valeur de la brillante. `shinyChaser` dépense exactement le palier de sa case, sans amplificateur, contre 4 points pour `counter` : son score mélange la brillante et une sous-dépense (relevé par la relecture finale). D'où la mesure A/B ci-dessous.

## Mesure A/B : la même stratégie, sans puis avec la brillante

6 000 matchs par ligne (`simulateMatch`, graines `ab-0…`). Seul change `BALANCE.shiny.multiplier`.

| Duel | ×1,0 (sans) | ×1,2 (avec) | Écart |
|---|---|---|---|
| Chasseur de brillantes contre contre-picker | 13,7 % | 21,5 % | +7,8 |
| Chasseur de brillantes contre aléatoire | 26,6 % | 35,1 % | +8,5 |
| Chasseur de brillantes contre glouton | 9,6 % | 16,0 % | +6,4 |
| Contre-picker contre aléatoire | 60,7 % | 60,8 % | +0,1 |

**Conclusion.**
- **La brillante a une vraie valeur** : environ +7 à +9 points de victoire pour qui la joue. La chercher est gratifiant.
- **Elle n'efface pas la lecture** : l'avantage du contre-picker est intact, et courir après la brillante sans lire reste nettement perdant.

Aucun changement d'équilibrage nécessaire.

## Sortie brute

```
  Taux de victoire par strategie
    random                 53.6 %
    greedy                 75.2 %
    counter                67.3 %
    thrifty                48.6 %
    allin                  15.2 %
    shinyChaser            40.0 %

  Taux de victoire par style
    calme                  50.1 %
    hype                   50.1 %
    provoc                 49.8 %
    acrobatie              49.7 %
    prouesse               50.2 %

  Taux de victoire par palier
    palier 0               11.9 %
    palier 1               28.8 %
    palier 2               37.5 %
    palier 3               54.3 %
    palier 4               69.0 %

  Valeur d un point d energie, par manche
    manche 1               18.72 points de score
    manche 2               26.01 points de score
    manche 3               22.38 points de score

  Mesure du skill — 1000 matchs par duel
    Timing                 72.0 %   Que vaut la jauge de timing, a choix et budget identiques ?
    Lecture                63.0 %   Que vaut le contre, face a un adversaire previsible ?
    Budget                 62.2 %   Que vaut le double de budget, a talent identique ?
    Talent contre budget   70.6 %   Qui gagne : lire et viser juste, ou depenser deux fois plus ?
    (temoin, deux sondes identiques) 50.5 %

  Seuils de docs/09-testing.md
    ok   Style le plus faible                     49.7 %   (attendu 47.0 % – 53.0 %)
    ok   Style le plus fort                       50.2 %   (attendu 47.0 % – 53.0 %)
    ok   Meilleure strategie contre l aleatoire   70.9 %   (attendu 0.0 % – 80.0 %)
    HORS Tout sur une manche contre econome        2.5 %   (attendu 40.0 % – 60.0 %)
    ok   Manches nulles                            0.0 %   (attendu 0.0 % – 3.0 %)
    ok   Matchs en trois manches                  52.9 %   (attendu 30.0 % – 55.0 %)
    ok   Avantage d un bon timeur                 68.9 %   (attendu 60.0 % – 75.0 %)
    ok   Talent contre budget                     70.6 %   (attendu 55.0 % – 85.0 %)

  1 mesure(s) hors de la zone saine.
```
