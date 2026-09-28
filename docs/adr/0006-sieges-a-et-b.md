# ADR 0006 — Les sièges s'appellent `a` et `b`, jamais `left` et `right`

- Statut : accepté
- Date : 2026-09-16

## Contexte

`docs/03-pvp-protocol.md` décrit `match:found { seat: 'left' | 'right' }`, et le prototype
manipule `B.sides.left` / `B.sides.right`. Mais dans le prototype, `left` désigne **le joueur
local** et `right` **l'adversaire** : ce sont des positions à l'écran, relatives au
spectateur.

Or `match:found` annonce à chaque joueur *quel siège il occupe*. Les deux joueurs d'un même
match reçoivent donc des valeurs différentes pour la même partie, alors que chaque client
dessine naturellement son propre personnage à gauche. On aurait un identifiant nommé d'après
une position, qui ne correspond pas à la position effectivement rendue. C'est une source de
confusion garantie — et la confusion sur « qui est qui » dans un match est exactement le
genre de bug qui produit une fuite d'information ou un score attribué au mauvais joueur.

## Décision

Le type `Seat` vaut `'a' | 'b'`, défini dans `@aura/rules` et réutilisé tel quel par
`@aura/protocol`, la base de données et les journaux d'événements.

Le côté de l'arène où un personnage est dessiné est une **décision de rendu**, prise par le
client : il place son propre siège à gauche, quel qu'il soit.

## Conséquences

- Un seul vocabulaire du moteur jusqu'à la base : pas de table de correspondance, pas de
  conversion à oublier.
- Un journal de match relu six mois plus tard reste lisible : « siège a » ne prétend pas
  décrire une position.
- Le client garde toute liberté de mise en scène (inversion de caméra, rejeu vu de
  l'adversaire) sans toucher au protocole.
- `docs/03-pvp-protocol.md` garde `left`/`right` dans ses tableaux à titre historique ; cet
  ADR fait foi.
