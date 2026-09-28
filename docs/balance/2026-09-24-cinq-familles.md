# Cinq familles — mesure du 2026-09-24

Simulation après le passage de trois à cinq familles (ADR 0014), multiplicateurs de contre **inchangés** (×1,35 / ×0,85).

Commande : `pnpm sim --matches 10000 --strategy all` (graine « sim »).

## Ce qu'il fallait vérifier

La roue à cinq change la probabilité de contre face à un choix au hasard : 40 % de contrer, 40 % d'être contré, 20 % de miroir, contre un tiers chacun à trois familles. La question était de savoir si une famille en profitait, et si l'ensemble de l'équilibrage bougeait.

## Résultat

| Mesure | Avant (17/09, trois familles, 8 000 matchs) | Maintenant (cinq familles) | Zone saine |
|---|---|---|---|
| Famille la plus faible | 49,7 % | **49,5 %** (Hype) | 47–53 % |
| Famille la plus forte | 50,6 % | **50,6 %** (Calme) | 47–53 % |
| Tout sur une manche contre économe | 3,1 % | 3,0 % | 40–60 % (hors zone, déjà avant) |
| Avantage d'un bon timeur | 68,4 % | 68,9 % | 60–75 % |
| Contre-picker (stratégie) | 64,1 % | 65,0 % | — |
| Talent contre budget | — | 70,1 % | 55–85 % |

Les cinq familles sont à moins de 0,6 point de 50 %. **Aucun changement de `balance.ts` n'est nécessaire.**

« Tout sur une manche contre économe » reste hors zone, **comme avant** (3,1 % le 17/09). Le rapport du 17/09 a établi que ce seuil est structurellement inatteignable : une stratégie qui ne dispute qu'une manche ne peut pas en gagner deux. La roue n'y change rien.

## Sortie brute

```
  Taux de victoire par strategie
    random                 51.5 %
    greedy                 72.6 %
    counter                65.0 %
    thrifty                46.4 %
    allin                  14.5 %

  Taux de victoire par style
    calme                  50.6 %
    hype                   49.5 %
    provoc                 49.8 %
    acrobatie              50.1 %
    prouesse               50.1 %

  Taux de victoire par palier
    palier 0               11.8 %
    palier 1               25.0 %
    palier 2               34.8 %
    palier 3               49.1 %
    palier 4               66.7 %

  Valeur d un point d energie, par manche
    manche 1               17.87 points de score
    manche 2               24.68 points de score
    manche 3               20.85 points de score

  Mesure du skill — 1000 matchs par duel
    Timing                 72.0 %   Que vaut la jauge de timing, a choix et budget identiques ?
    Lecture                62.8 %   Que vaut le contre, face a un adversaire previsible ?
    Budget                 62.5 %   Que vaut le double de budget, a talent identique ?
    Talent contre budget   70.1 %   Qui gagne : lire et viser juste, ou depenser deux fois plus ?
    (temoin, deux sondes identiques) 50.4 %

  Seuils de docs/09-testing.md
    ok   Style le plus faible                     49.5 %   (attendu 47.0 % – 53.0 %)
    ok   Style le plus fort                       50.6 %   (attendu 47.0 % – 53.0 %)
    ok   Meilleure strategie contre l aleatoire   68.0 %   (attendu 0.0 % – 80.0 %)
    HORS Tout sur une manche contre econome        3.0 %   (attendu 40.0 % – 60.0 %)
    ok   Manches nulles                            0.0 %   (attendu 0.0 % – 3.0 %)
    ok   Matchs en trois manches                  52.7 %   (attendu 30.0 % – 55.0 %)
    ok   Avantage d un bon timeur                 68.9 %   (attendu 60.0 % – 75.0 %)
    ok   Talent contre budget                     70.1 %   (attendu 55.0 % – 85.0 %)

  1 mesure(s) hors de la zone saine.
```
