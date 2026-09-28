# ADR 0014 — Des poses de côté, jamais au-dessus

- **Statut :** accepté
- **Date :** 2026-09-24
- **Spec :** `docs/superpowers/specs/2026-09-24-poses-cinq-familles-design.md`

## Contexte

En duel, le joueur choisissait un **style** parmi trois, Calme, Hype ou Provoc :
un pierre-feuille-ciseaux, trop pauvre pour porter la lecture et le bluff d'un
jeu compétitif. Le contenu comptait 33 poses (Dab, Griddy, Mewing, Salto
arrière…), mais elles n'étaient qu'un skin équipé d'avance : une pose achetée ne
se *jouait* pas, elle se portait.

Le joueur veut choisir des poses en duel, toutes celles d'une vraie *aura
battle*, et pouvoir les obtenir en jouant ou plus vite avec des jetons. Cela
touche la règle d'or n°3, qui interdisait de vendre quoi que ce soit touchant au
score.

## Décision

1. **Cinq familles au lieu de trois**, sur un cercle : Calme, Hype, Provoc,
   Acrobatie, Prouesse. Chacune bat la suivante et celle à trois crans. C'est la
   seule roue à cinq où toutes ont le même profil (deux victoires, deux
   défaites). Les trois contres historiques sont conservés, et les
   multiplicateurs (×1,35 / ×0,85) valent pour toutes les paires.
2. **Une pose = une famille + un palier.** Toutes les poses d'une même case ont
   exactement la même puissance. Le moteur (`@aura/rules`) ne voit jamais de
   pose, seulement le mouvement.
3. **Chaque case a une pose offerte** : la première de sa liste dans
   `MOVE_ANIMATIONS`, de rareté `default`. Le kit gratuit répond donc à tout.
4. **Règle d'or n°3 réécrite** : « des poses de côté, jamais au-dessus ». Tout ce
   qui modifie un score s'obtient en jouant ; l'argent ne fait que raccourcir
   l'attente, et une pose achetable n'est jamais plus forte que la pose offerte
   de sa case.
5. **Protocole 2.0.0.** `choice:lock` envoie une `poseId` au lieu de `move`. Le
   serveur en déduit le mouvement (`moveOfAnimation`), puis :
   - un identifiant qui n'est **pas une pose** est refusé (`INVALID_PAYLOAD`,
     non rejouable) et compté au seul siège fautif : un client honnête n'en
     envoie jamais ;
   - une pose valide mais **ni offerte ni possédée** verrouille quand même son
     mouvement, avec la **pose offerte de la case**, et le joueur reçoit un
     simple avertissement (`COSMETIC_NOT_OWNED`), sans suspicion. La refuser
     ferait d'un achat cosmétique un désavantage de jeu (règle d'or n°3) : il
     suffit d'un inventaire indisponible à la connexion pour qu'un joueur
     honnête joue une pose achetée que le match ne lui connaît pas.
6. **Choix par défaut :** un siège qui ne verrouille pas joue le palier 0 de la
   famille tirée par la graine, et c'est cette famille — pas une famille de
   repli fixe — que la révélation et la trace de fantôme nomment.

## Conséquences

- **Garde-fou vérifié par construction.** Le score ne peut pas dépendre de ce
  qu'on possède, puisque le moteur ne reçoit jamais la pose ; un test de contenu
  garantit une pose offerte par case. Une simulation « kit gratuit contre
  collection complète » donnerait 50 % par construction et ne prouverait rien.
- **Contenu :** 39 poses, dont 25 offertes. Quatre poses de voltige ont changé de
  famille et d'identifiant (`anim.hype.t4.wheel` est devenu
  `anim.acrobatie.t2.wheel`), et le seed retire les anciens. Six poses sont
  nouvelles : Roulade, Biceps contractés, Pompes, Planche, Poirier et Drapeau
  humain.
- **Pas de remboursement :** aucun joueur réel au 2026-09-24.
- **`loadout.dances` change de rôle :** ce n'est plus la danse révélée, mais la
  pose présélectionnée de chaque case. Le chemin serveur qui suivait les danses
  en cours de match a disparu.
- **Fantômes :** les enregistrements en trois styles restent valides et révèlent
  la pose offerte de leur case. Acrobatie et Prouesse n'y apparaîtront qu'au fil
  des nouveaux enregistrements.
- **Un client 1.x** est renvoyé sur l'écran de mise à jour dès la connexion.
- **Reste à faire, en chantiers séparés :** écran de choix en cartes de pose,
  mise en scène de la révélation, qualité des animations, boutique et jetons.
