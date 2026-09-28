# Événements de la semaine — mesures (2026-09-25)

Simulateur : `runTournament`, 6 000 matchs par configuration, toutes les
stratégies les unes contre les autres (`packages/rules/src/sim`).

## Les variantes retenues

| Variante | greedy | counter | shinyChaser | timing (60 % contre 20 % de parfaits) | familles |
|---|---|---|---|---|---|
| Normale | 75,0 % | 66,8 % | 39,3 % | 67,5 % | 49–51 % |
| Semaine brillante (brillante ×1,5) | 73,6 % | 64,6 % | **47,9 %** | 67,4 % | 49–51 % |
| Contres tranchants (contre ×1,6) | 74,1 % | 65,3 % | 40,5 % | 66,2 % | 49–51 % |
| Ultime express (jauge 60) | 77,6 % | 67,5 % | — | 69,8 % | 49–52 % |

- **Semaine brillante** fait ce qu'on lui demande : chasser la carte brillante
  devient viable (39 % → 48 %) sans dominer.
- **Contres tranchants** reste neutre pour les stratégies simulées : c'est un
  événement d'ambiance. Le simulateur ne sait pas lire un adversaire humain ; le
  vrai effet se mesurera en jeu (M10, analytics).
- **Ultime express** déplace peu (greedy +2,6 points), et le timing pèse un peu
  plus.

## La variante écartée : plus d'énergie

| Énergie de départ | greedy | counter | thrifty |
|---|---|---|---|
| 14 (normal) | 75,7 % | 65,7 % | 49,5 % |
| 16 | 80,8 % | 63,7 % | 48,8 % |
| 18 | 83,1 % | 63,0 % | 48,5 % |
| 20 | 84,4 % | 62,6 % | 48,4 % |

Toute énergie en plus récompense « toujours le plus gros » : dès 16, la
stratégie gagne cinq points, et choisir ne compte plus. Aucune variante ne
touche à l'énergie de départ — un test le garde (`variants.test.ts`).
