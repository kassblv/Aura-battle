# Indicateurs produit — chantier n°8 (M10)

Date : 2026-09-26 · Statut : décidé sur recommandation (« continue jusqu'au
bout ») ; relisible.

## Pourquoi

`docs/00-vision.md` fixe sept seuils de décision (rétention J1 ≥ 35 %, J7 ≥ 12 %,
≥ 4 matchs PvP par actif et par jour…). Sans mesure, « le jeu le plus addictif
possible » reste une opinion. Il faut les lire **dès le premier joueur**.

## Décision : mesure interne, pas de fournisseur

- **Aucun traceur tiers.** Pas de SDK d'analytics, pas de donnée qui quitte nos
  serveurs, donc pas de bandeau de consentement pour un traceur tiers et rien à
  choisir chez un fournisseur. Les données restent dans notre Postgres, sous
  l'identifiant de joueur déjà pseudonyme.
- **Presque tout se déduit de l'existant** : `Player.createdAt`, `Match`
  (mode, `startedAt`, `endReason`, `isGhost`), `MatchSeat`. On ne rajoute que ce
  que le serveur ne garde pas encore :
  - `MatchSeat.queueWaitMs` : l'attente en file du siège (le serveur la connaît
    à l'appariement, `enqueuedAtMs`) ;
  - un **événement client** unique, `clip_shared`, parce que seul le client sait
    qu'un clip est parti.
- **Lecture** : `GET /admin/indicators`, même secret que `/admin/status`, et une
  section du panneau d'administration. Lecture seule.

## Définitions (jours UTC)

- **Match PvP** : mode `RANKED`, `CASUAL` ou `INVITE` (fantômes compris — le
  joueur joue ; leur part est affichée à côté). `SOLO` n'en est pas un.
- **Actif le jour D** : a occupé un siège d'un match PvP commencé le jour D.
- **Rétention J1** : parmi les comptes créés un jour D (D entre J-31 et J-2),
  la part active le jour D+1. **J7** : même chose à D+7 (D entre J-37 et J-8).
- **Matchs PvP par actif et par jour** : sur les 7 derniers jours complets,
  sièges PvP occupés par un joueur réel ÷ somme des actifs quotidiens.
- **Attente médiane en file classée** : médiane de `queueWaitMs` des sièges
  `RANKED` des 7 derniers jours.
- **Part des matchs partagés en clip** : matchs PvP terminés sur 7 jours dont au
  moins un siège a émis `clip_shared` ÷ matchs PvP terminés sur 7 jours.
- **Installations issues d'invitations** : parmi les comptes créés sur 30 jours
  qui ont joué, la part dont le **premier** match PvP est une invitation.
- **Taux d'abandon** : matchs PvP terminés sur 7 jours avec `endReason`
  `forfeit` ou `disconnect` ÷ matchs PvP terminés sur 7 jours.

Chaque indicateur rend sa valeur, son **effectif** (`n`) et son seuil ; sous
20 observations, le panneau écrit « échantillon insuffisant » au lieu de
colorer un verdict.

## Événement client

- `POST /events`, authentifié, corps strict : `{ kind: 'clip_shared', matchId }`
  (`@aura/protocol`, 2.5.0).
- Envoyé après un partage **ou** un téléchargement du clip (sur le web, on
  télécharge puis on poste à la main). Jamais bloquant, jamais relancé : une
  mesure perdue vaut mieux qu'un écran qui attend.
- Le serveur ne l'inscrit que si le joueur **a occupé un siège de ce match**, et
  une seule fois par (joueur, match, sorte) : la table est bornée par
  construction, un renvoi est sans effet. Réponse `204` dans tous les cas
  acceptés, pour ne rien apprendre à qui sonde.

## Architecture

- `@aura/protocol` : `productEventSchema` (2.5.0).
- Serveur :
  - module `analytics` : `POST /events` et le dépôt `ProductEvent` ;
  - `MatchSeat.queueWaitMs` écrit à la création du match depuis la file ;
  - calcul des indicateurs : requêtes d'agrégat (adaptateur Prisma) et verdict
    pur (seuils, effectif minimal) ;
  - `GET /admin/indicators` et la section du panneau.
- Mobile : `reportClipShared(matchId)` après un partage réussi.

## Critères d'acceptation

- [x] Chaque définition testée contre Postgres sur un jeu de données construit à
  la main (valeur ET effectif) ; deux définitions cassées exprès font tomber
  les tests. Chaque scénario vit à une date de 1980–1998 qui lui est propre :
  aucune donnée d'une autre suite ne tombe dans ses fenêtres.
- [x] Verdict pur testé : seuil atteint, manqué, échantillon insuffisant.
- [x] `POST /events` : siège absent → rien d'inscrit ; renvoi → une seule ligne ;
  corps inconnu → 400 ; sans jeton → 401.
- [x] `queueWaitMs` écrit pour un appariement en file, absent pour une invitation
  et pour le siège d'un fantôme.
- [x] Le client envoie l'événement après un partage ou un téléchargement, pas
  après une annulation ; un échec réseau ne se voit pas.
- [x] Panneau vérifié à l'écran (instance séparée, données semées puis
  supprimées) ; lint, typecheck, tests ; relecture de sécurité : aucun point
  critique ni important. Mineur corrigé : le rapport est gardé une minute
  (huit agrégats sur toute la base par calcul).
- [x] Relecture finale (opus) : les sept définitions vérifiées une à une, aucun
  point critique ni important. Mineurs corrigés : le cache ne sert plus un
  rapport « venu du futur » quand l'horloge serveur recule (test), et le
  commentaire du lecteur dit désormais quelles fenêtres restent ouvertes.

## Limites connues

- **`clip_shared` est déclaratif.** Un script peut l'envoyer après chacun de ses
  matchs sans rien partager : l'indicateur monterait d'un match par match joué,
  jamais pour le match d'un autre, et rien d'autre n'en dépend (ni score, ni
  récompense). C'est la limite de toute mesure que seul le client connaît.
- **Un partage envoyé dans les millisecondes qui suivent `match:end`** peut
  arriver avant l'écriture du match en base : il n'est pas compté. L'indicateur
  est sous-estimé, jamais gonflé.
- **Un partage vers une autre application** peut faire tuer le jeu par le
  système pendant la feuille de partage : la promesse meurt avec le processus,
  l'événement n'est pas envoyé. Sous-estimation marginale.
- Les matchs antérieurs à la migration n'ont pas de `queueWaitMs`.
- Pas d'index sur `Match.endedAt` ni `Player.createdAt` : à poser quand la base
  grossira (le cache d'une minute suffit d'ici là).
