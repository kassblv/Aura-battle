# 0017 — Le clip de révélation se compose dans le client, image par image

Date : 2026-09-25 · Statut : accepté après un essai dans le navigateur (jalon M9).

## Contexte

Un duel d'aura se partage : c'est le mème qui fait venir les joueurs. Le
moment à partager est la **révélation** (≈ 4,5 s) : les deux poses, le contre,
le choc. Le format attendu par Shorts, Reels et TikTok est **vertical (9:16)**.
Le jeu, lui, est en paysage.

## Ce que l'essai a mesuré (Chrome 154, 844×390, DPR 2)

- `canvas.captureStream(30)` + `MediaRecorder` enregistre l'arène sans rien
  changer au rendu. **MP4 H.264 est pris en charge** (`video/mp4;codecs=avc1`),
  WebM aussi. 2 s à 4 Mb/s ≈ 1 Mo, et le fichier se relit (1477×682).
- `navigator.canShare({ files: [clip.mp4] })` répond **oui** : la feuille de
  partage du système accepte le fichier.
- **Copier le canvas WebGL hors de sa propre image rend du noir** (0 pixel
  allumé) : `preserveDrawingBuffer` est faux, et doit le rester (coût sur
  mobile). La même copie faite juste après le rendu, dans l'image, est juste.
- **Recadrer l'arène en 9:16 coupe les deux combattants**, placés à gauche et à
  droite : il ne resterait que le centre.

## Décision

- **Composition dans le client, image par image**, sur un canvas 2D 720×1280
  enregistré par `MediaRecorder` :
  - l'arène **entière**, en bande au milieu (720 de large) ;
  - au-dessus : les deux cartes jouées et le bandeau du contre (« 🤸 BAT 💪 ·
    ×1,35 ») en grand ;
  - en dessous : le verdict de la manche et l'appel « Défie-moi » avec le nom du
    jeu. Le lien d'invitation voyage dans le TEXTE du partage, cliquable.
- **La copie se fait dans la boucle de l'arène**, juste après le rendu : l'arène
  expose un abonnement « image rendue ». Jamais de `preserveDrawingBuffer`.
- **On n'enregistre que la révélation**, et seulement celle qu'on proposera :
  le **dernier coup gagnant** du joueur. Un enregistrement permanent coûterait
  de l'encodage à chaque manche pour rien.
- **Partage** : `navigator.share({ files })` sur le web. Sur mobile, le fichier
  est écrit dans le cache puis partagé par `@capacitor/share` (greffons chargés
  par import dynamique derrière `isNative()`).
- MP4 si le navigateur sait l'encoder, WebM sinon (le partage refusera peut-être
  un WebM sur iOS : on le dit plutôt que d'échouer en silence).
- **Rien ne part vers un serveur** : pas de rendu serveur, pas de stockage de
  vidéo, pas de donnée personnelle ajoutée.

## Conséquences

- Un coût d'encodage pendant ≈ 5 s, une fois par match au plus.
- Le clip ne montre que ce que le joueur a vu : aucune information cachée n'y
  entre (règle d'or n° 4), puisque la révélation est déjà publique.
- iOS : `MediaRecorder` existe depuis iOS 14.3 et produit du MP4 ; à vérifier sur
  appareil, hors de portée d'ici.
