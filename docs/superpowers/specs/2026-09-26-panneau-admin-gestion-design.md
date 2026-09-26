# Panneau d'administration qui gère — chantier n°10

Date : 2026-09-26 · Statut : décidé sur recommandation (« pense à développer le
panel administrateur pour gérer tout cela ») ; relisible.

## Pourquoi

Le panneau (`/admin`) ne fait que montrer : santé, indicateurs, expériences.
Tout ce qui se règle — la part d'une expérience, l'événement de la semaine, un
joueur à écarter — demande une variable d'environnement et un redémarrage, ou
n'est pas possible du tout. Pour **faire vivre** le jeu au-delà du mème, il faut
pouvoir agir sans déployer.

Découpage : ce chantier donne au panneau ses **premières écritures** et sa propre
application. Le chantier n°11 y ajoutera le **contenu servi** (publier une
danse, éditer le catalogue) — il a besoin de ce socle.

## Décisions (ADR 0018)

- **Une application `apps/admin`** (Vite + React + TypeScript strict), servie
  par Nest sous `/admin` dans le même conteneur. Jamais dans le paquet des
  joueurs. La page HTML en chaîne (`admin-page.ts`) disparaît.
- **Même secret** (`ADMIN_TOKEN`), saisi une fois et gardé en `sessionStorage`
  (perdu à la fermeture de l'onglet). En-tête `Authorization`, pas de cookie :
  pas de CSRF. Essais de secret **limités en débit** (10 par minute et par IP).
- **Chaque écriture est journalisée** (`AdminAction` : instant, action, cible,
  avant, après, motif). Une écriture sans journal n'a pas lieu (même
  transaction).
- **Contrat partagé** : les requêtes et réponses admin sont des schémas zod de
  `@aura/protocol` (`admin.ts`), validés à l'entrée par le serveur et utilisés
  par l'application.
- **Aucune écriture ne contourne une règle du jeu** : les réglages passent par
  les mêmes fonctions que le code (variantes de `RULE_VARIANTS`, bornes de
  part, etc.).

## Ce que le panneau gère

1. **Tableau de bord** : santé (`/admin/status`), indicateurs, expériences —
   l'existant, dans la nouvelle application.
2. **Expériences (drapeaux)** :
   - voir la part et la **mesure** en cours de chaque drapeau ;
   - **couper** (part 0) ou **rallumer** à la part de la mesure en cours ;
   - **ouvrir une nouvelle mesure** avec une autre part : l'époque du drapeau
     monte (`intentBubble#2`), l'affectation est re-hachée avec l'époque, les
     inscriptions repartent de zéro. C'est la seule façon de changer de part
     (relecture finale du chantier n°9 : changer la part d'une mesure mélange
     les groupes). La lecture `/admin/experiments` porte sur la mesure en cours.
   - Réglages en base (`FlagSetting`) ; l'environnement ne donne plus que la
     valeur initiale. Chaque nœud relit les réglages toutes les 30 s.
3. **Événement de la semaine** :
   - voir la variante de la semaine en cours et des quatre suivantes (rotation) ;
   - **forcer** une variante de `RULE_VARIANTS`, ou « normale », pour une
     semaine donnée (`RuleEventOverride`, clé = numéro de semaine UTC) ;
     revenir à la rotation. Le serveur décide toujours à l'ouverture du match ;
     l'accueil du client suit (la variante de la semaine est servie par
     `GET /events/week`, au lieu d'être recalculée par le client).
4. **Joueurs** :
   - recherche par nom ou identifiant (20 résultats au plus) ;
   - fiche : nom, création, dernière venue, niveau, portefeuille, ligue, matchs
     récents, bannissement ;
   - **bannir** jusqu'à une date (ou définitivement) avec un **motif
     obligatoire**, **lever** un bannissement. **Le bannissement est appliqué**
     — il ne l'était pas : `Player.bannedUntil` existait sans être lu. Un banni
     est refusé au rafraîchissement de session et au handshake socket
     (`BANNED`), et un match en cours se termine par forfait.
5. **Journal d'administration** : les dernières actions, filtrables.

## Hors périmètre

- Comptes administrateurs nommés et rôles (un seul secret aujourd'hui ; le
  journal n'a donc pas d'auteur nominatif — noté).
- Modifier un portefeuille ou un inventaire (geste trop sensible pour un
  premier jet ; à décider avec un vrai besoin de support).
- Contenu et catalogue : chantier n°11.

## Critères d'acceptation

- [ ] Chaque route d'écriture : 404 sans `ADMIN_TOKEN`, 401 sans le bon secret,
  400 sur un corps invalide, journal écrit dans la même transaction (tests).
- [ ] Nouvelle mesure : l'époque monte, les groupes sont re-hachés, l'ancienne
  mesure ne se mélange pas à la nouvelle (tests).
- [ ] Forçage d'événement appliqué à l'ouverture d'un match de la semaine
  visée, jamais au classé (tests).
- [ ] Bannissement appliqué : refus au rafraîchissement et au handshake, match
  en cours perdu par forfait ; levée effective (tests e2e).
- [ ] Application admin vérifiée à l'écran (bureau et tablette) ; lint,
  typecheck, tests ; relecture de sécurité et relecture finale.
