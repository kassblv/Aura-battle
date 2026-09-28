# ADR 0008 — Le jeu se tient en paysage, à deux mains

- Statut : accepté
- Date : 2026-09-18

## Contexte

Une manche demande trois gestes rapides et précis : taper des orbes qui vivent entre 950 et
1 600 ms, choisir un mouvement en moins de quinze secondes, et arrêter une jauge de timing
dont la fenêtre « parfait » vaut 9 % de la course. Rater un geste coûte une manche.

Un téléphone tenu à une main n'offre qu'un seul pouce et un arc de portée étroit. La zone
réellement atteignable sans changer de prise couvre environ le tiers bas de l'écran, et la
précision y chute nettement en haut de l'arc. En portrait, une arène assez grande pour lire
deux personnages et leurs auras occupe le haut de l'écran — c'est-à-dire précisément la zone
hors de portée.

Le prototype est une page de bureau : il ne tranche pas la question, et sa mise en page en
colonne ne se transpose pas.

## Décision

Le client est **exclusivement en paysage**. En portrait, il n'affiche pas une version
dégradée : il demande de tourner l'appareil.

Trois conséquences de mise en page en découlent, et elles ne sont pas négociables :

1. **Rien d'interactif au centre haut.** C'est la zone morte entre les deux pouces. Titres,
   scores et bandeaux de phase y vivent ; aucune cible tactile.
2. **Les commandes vivent dans les arcs de pouce**, en bas à gauche et en bas à droite.
   Style à gauche, palier et amplificateur à droite : les deux mains travaillent en
   parallèle pendant les quinze secondes du choix.
3. **Les orbes de recharge sont tirées en coordonnées d'écran, puis déprojetées** dans la
   scène 3D — jamais l'inverse. Tirer un point du monde et espérer qu'il tombe à portée ne
   garantit rien.

La cible tactile minimale est de 46 px, et la jauge de timing accepte un appui **n'importe
où** sur l'écran : c'est le geste le plus contraint en temps de tout le jeu, il mérite la
plus grande cible possible.

## Conséquences

- Capacitor verrouille l'orientation en paysage (iOS et Android), et le web affiche un écran
  « tourne ton téléphone » sous `@media (orientation: portrait)`.
- Les tests de rendu et les captures de référence se font en paysage ; une mise en page
  portrait n'est jamais à maintenir.
- Le confort des tablettes et du bureau vient gratuitement : le paysage y est déjà la forme
  naturelle.
- On perd les joueurs qui jouent une main dans le métro. C'est assumé : `docs/00-vision.md`
  fixe ≤ 5 % d'abandon en cours de match, et un geste raté par ergonomie est un abandon.
