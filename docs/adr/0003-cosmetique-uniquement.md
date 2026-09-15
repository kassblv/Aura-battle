# ADR 0003 — Mouvements de gameplay séparés des animations, monétisation cosmétique

- Statut : acceptée
- Date : 2026-09-16

## Contexte

Dans le prototype, chaque danse a sa propre puissance et s'achète avec des pièces, ce qui crée un avantage payant incompatible avec un classement PvP. Les danses tendance changent vite.

## Décision

- Le score dépend d'un **mouvement** (style + palier) et d'un **amplificateur**, accessibles à tous et limités par l'énergie du match.
- Chaque danse est un **skin** d'un mouvement ; chaque effet d'aura est un skin d'un amplificateur.
- La boutique et le passe de saison ne vendent que du cosmétique.

## Conséquences

- Les mèmes peuvent entrer et sortir du jeu sans toucher à l'équilibrage.
- L'équilibrage se fait sur 15 mouvements et 5 amplificateurs au lieu d'une liste croissante de danses.
- Le serveur doit vérifier que le skin envoyé correspond au mouvement joué et qu'il est possédé.
