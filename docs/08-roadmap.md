# 08 — Roadmap et critères d'acceptation

Claude Code coche les cases au fil de l'eau. Un jalon est terminé quand toutes ses cases sont cochées et que `/ship-check` passe.

Phase 1 (M0 → M6) : **PvP jouable sur mobile, en ligne, classé**. C'est la priorité absolue.

---

## M0 — Monorepo et outillage

- [x] pnpm workspaces + Turborepo ; scripts racine `dev`, `build`, `test`, `lint`, `typecheck`, `sim`
- [x] TypeScript strict partagé (`tsconfig.base.json`), ESM, alias de chemins
- [x] ESLint (typescript-eslint) + Prettier, config partagée
- [x] Vitest dans chaque package et app, avec un test d'exemple vert
- [x] `docker-compose.yml` : Postgres 16, Redis 7 ; `.env.example`
- [x] CI GitHub Actions : install avec cache, lint, typecheck, test
- [x] Packages `@aura/rules`, `@aura/protocol`, `@aura/content` et apps `server`, `mobile` créés et compilables

## M1 — `@aura/rules` : moteur de règles pur *(critique)*

Référence : `docs/01-game-design.md`, `docs/02-architecture.md` (forme attendue).

- [x] `balance.ts` avec toutes les valeurs du game design, typées et gelées
- [x] RNG seedé déterministe + tests de reproductibilité
- [x] Génération de la séquence d'orbes et des paramètres de jauge à partir d'une graine
- [x] Évaluation de la recharge : validation des taps, combos, orbes dorées, plafond 12/s, gains (boost, Ultime, énergie)
- [x] Évaluation du timing : position du curseur, qualité, écart
- [x] Résolution d'une manche : coûts, répétition, Ultime, contres, contre bloqué, score, départage
- [x] Machine d'état du match (`reduce`) : phases, échéances, actions par défaut, forfait, fin de match et départage
- [x] IA solo (4 profils du prototype adaptés aux nouvelles règles)
- [x] Tests unitaires (couverture lignes ≥ 95 %) + tests de propriétés : score ≥ 1, énergie jamais négative, déterminisme (même graine + mêmes événements ⇒ même résultat), aucun état où les deux joueurs gagnent
- [x] CLI `pnpm sim` : N matchs entre stratégies (aléatoire, glouton, contre-picker, économe, tout-sur-une-manche), rapport JSON + résumé console

## M2 — `@aura/protocol` et `@aura/content`

Références : `docs/03-pvp-protocol.md`, `docs/07-content-pipeline.md`.

- [x] Schémas zod de tous les messages client→serveur et serveur→client, types inférés exportés
- [x] `PROTOCOL_VERSION` et codes d'erreur
- [x] Tests : chaque exemple du doc de protocole est accepté ; charges invalides rejetées
- [x] Schéma JSON des animations dans `packages/content`, validateur CLI (`validate`)
- [x] Port des 21 poses et des 5 animations système (charge, atterrissage, titubement, victoire, défaite) du prototype en JSON (skill `/port-prototype animations`), toutes valides
- [x] Index : animation par défaut par mouvement, liste des skins par mouvement
- [x] Catalogue initial des effets d'aura, couleurs, tenues, coiffures

## M3 — Serveur de match en ligne

Référence : `docs/02-architecture.md`, `docs/03-pvp-protocol.md`, `docs/04-data-model.md`.

- [x] NestJS hexagonal, config typée, logger pino, healthcheck
- [x] Prisma : schéma initial, migrations, seed (saison 1, catalogue)
- [x] Auth invité : `POST /auth/device` → JWT d'accès + refresh ; garde WebSocket
- [x] Gateway Socket.IO : validation zod entrante et sortante, limite de débit, `ping/pong`
- [x] Module match : création, `match:ready`, phases et timers pilotés par `@aura/rules`, envois ciblés sans fuite d'information
- [x] Invitations par code (`invite:create` / `invite:join`)
- [x] Déconnexion, reconnexion (`match:rejoin` → `match:state`), forfait — le match continue sans le joueur déconnecté, forfait au bout de 45 s s'il ne revient pas
- [x] Persistance du match, des manches et du journal d'événements
- [x] Tests e2e : deux clients Socket.IO jouent un match complet, timeout de choix, reconnexion en pleine manche, double verrouillage refusé, message hors match ignoré — plus un test d'intégration contre une vraie base Postgres. *Testcontainers reste à ajouter pour la CI, qui est bloquée pour facturation.*
- [x] Relecture `security-reviewer` sans point bloquant — 7 défauts trouvés et corrigés (3 dénis de service, 1 triche sans violation de règle, granularité des compteurs anti-triche, journal effaçable, squelette de rejeu)

## M4 — Client jouable en ligne

Référence : prototype, `docs/02-architecture.md`.

- [x] Vite + React + Three.js récent ; structure `app/ net/ match/ arena/ animation/ audio/ platform/`
- [ ] **Paysage exclusif** (ADR 0008) : écran « tourne ton téléphone » ✅, commandes dans les arcs de pouce ✅, rien d'interactif au centre haut ✅, cibles tactiles ≥ 46 px ✅, verrouillage par l'API `screen.orientation` ✅ — **verrouillage Capacitor : non fait, Capacitor n'est pas encore installé** (ni `capacitor.config.ts`, ni projets iOS/Android, ni haptique, ni liens profonds)
- [ ] Port du rendu 3D du prototype en modules : scène ✅, foule instanciée ✅ (avec les téléphones braqués), rig avec mains ✅, caméra ✅, calque 2D ✅ — **particules : écrites et testées mais parquées, branchées à rien** (les effets d'amplificateur reviendront) ; **choc : non fait**
- [ ] `AnimationPlayer` lisant `@aura/content` (Catmull-Rom, ressorts, angles, mains) ✅ — **page `/dev/animation-viewer` : non faite** (la galerie de mèmes de l'accueil la remplace pour l'usage courant, pas pour le débogage image par image)
- [x] Client réseau : synchronisation d'horloge, reconnexion automatique, reprise de `match:state`
- [x] Écrans : accueil ✅ (avec galerie de mèmes jouée par le personnage), créer/rejoindre une invitation ✅, attente ✅, match ✅, résultat ✅, revanche ✅ — en solo elle relance une partie sur une nouvelle graine, en ligne elle remet en file (l'adversaire précédent n'a aucune raison d'être encore là)
- [x] Recharge et timing mesurés avec `performance.now()` et envoyés selon le protocole
- [x] Moteur audio du prototype porté ; musique et effets activables — 23 sons synthétisés, aucun fichier embarqué ; déverrouillé au premier geste (sans quoi iOS reste muet en silence)
- [x] Solo contre IA fonctionnel hors ligne (même `@aura/rules`)
- [x] Test manuel documenté : `docs/09-testing.md`, § « Test manuel : un duel à deux navigateurs » — sept étapes, avec le piège des deux onglets d'une même origine qui partagent la même identité

## M5 — Classé, matchmaking et fantômes

Référence : `docs/05-matchmaking-ranking.md`.

- [x] File Redis, worker d'appariement (500 ms), fenêtre MMR qui s'élargit (±50 → ±400), `queue:status` — ADR 0009. L'appariement est pur et testé ; Redis est un adaptateur derrière un port ; `queue:leave`, la déconnexion et l'ouverture d'un match retirent le ticket. **Un seul chemin d'ouverture** avec l'invitation. Le MMR est *lu* (`Rating.mmr`, 1000 par défaut), jamais calculé — c'est la ligne suivante. Une seule région (`global`) : ni le modèle de données ni le protocole n'en portent encore.
- [x] MMR (décision Elo à K variable consignée en ADR 0010), LP, ligues, placements — le
  calcul est pur et testé par propriété (`apps/server/src/modules/rating/domain/rating.ts`),
  orchestré par `RatingSettlementService` (module `rating`, sans module Nest propre — câblé
  dans `match.module.ts`, ADR 0010), et écrit en base pour chaque match `RANKED` à la fin du
  match (`MatchRuntime.announceEnd`, qui libère les sièges avant d'attendre ce calcul).
  `match:found.league` lit la vraie ligue, mise en cache à la connexion et rafraîchie à chaque
  match classé. **Non fait : la réinitialisation douce de fin de saison, et le MMR caché
  séparé de la partie rapide** (`docs/05` les documente déjà, hors périmètre de ce jalon).
- [x] Enregistrement des fantômes et rejeu serveur ; LP réduits ; drapeau `ghost`. La
  bascule est pure et testée (`matchmaking/domain/ghost.ts` : 25 s en classé, 12 s en partie
  rapide, même fenêtre MMR que l'appariement humain). Un fantôme occupe un siège synthétique
  (`ghost:<id>:<nonce>`), passe par le **chemin d'ouverture unique**, et joue par les mêmes
  méthodes qu'un client (`GhostDirector` → `acceptSeq`, `submitTaps`, `lockChoice`) : phase,
  `seq`, instants déclarés, plafond de cadence et coût en énergie lui sont opposés comme à
  tout le monde. Les choix impayables sont rabattus par la politique de l'IA solo
  (`affordableChoice`, `@aura/rules`), le timing est rejoué à partir de l'**écart**
  enregistré sur la jauge de la manche en cours. Enregistrement à la fin de chaque match
  `RANKED` humain contre humain, une ligne par joueur (`GhostRecording`, table déjà au
  schéma). LP réduits de moitié **par le module `rating`**
  (`GHOST_LEAGUE_POINTS_MULTIPLIER`), et **rien n'est écrit au classement du fantôme**.
  `match:found.ghost` et `match:state.ghost` portent le drapeau — il survit donc à une
  reconnexion. **Non fait : le client n'affiche pas encore « Adversaire en différé »**
  (`apps/mobile`, hors périmètre de cet agent).
- [ ] Écrans : partie classée ✅ et partie rapide ✅ (choix sur l'accueil, `queue:join` émis avec le mode), profil affichant la ligue ✅ — **historique et classement : non faits**
- [x] Tests : appariement par MMR ✅, élargissement ✅, entrée/sortie de file et tickets fantômes ✅ (e2e à deux clients), bascule vers fantôme ✅ (`ghost-e2e.test.ts` : un duel humain est enregistré puis rejoué contre un joueur seul), sélection de fantôme en propriétés `fast-check` ✅, LP réduits ✅

## M6 — Application mobile

- [ ] Capacitor iOS et Android, icônes, splash, **verrouillage en paysage** (ADR 0008 ; cette ligne disait « orientation portrait », écrite avant l'ADR)
- [ ] Haptique (`@capacitor/haptics`), cycle de vie (arrière-plan ⇒ fermeture et reconnexion)
- [ ] Deep links et universal/app links pour les invitations
- [ ] Niveaux de qualité graphique automatiques (foule, doigts, particules, pixel ratio) et réglage manuel
- [ ] Budget : 60 i/s visés, 30 i/s minimum sur appareil milieu de gamme ; mesure documentée
- [ ] Builds de test : TestFlight et piste interne Google Play

---

## Phase 2 — Durer

### M7 — Anti-triche et robustesse
- [ ] Contrôles de cohérence temporelle et plafonds (voir `06-anti-cheat.md`)
- [ ] Job de détection statistique + `SuspicionFlag` + sanctions progressives
- [ ] Test de charge : 500 matchs simultanés sur un nœud, p95 de traitement d'un message < 20 ms
- [ ] Multi-nœuds : adaptateur Redis, sessions collantes, reprise d'un match après redémarrage d'un nœud (instantané de fin de manche)

### M8 — Méta et monétisation cosmétique
- [ ] Inventaire, loadout (animation par mouvement, effet par amplificateur), boutique à rotation
- [ ] Défis quotidiens côté serveur
- [ ] Passe de saison (gratuit + premium)
- [ ] Achats intégrés via RevenueCat, reçus validés côté serveur

### M9 — Partage
- [ ] Spike : export d'un clip vertical de la révélation (MediaRecorder sur le canvas ou rendu serveur), choix en ADR
- [ ] Partage natif, lien d'invitation intégré au clip

### M10 — Live-ops
- [ ] Feature flags, événements de règles en données, bulle d'intention en test A/B
- [ ] Contenu servi avec `contentVersion` et cache client
- [ ] Analytics produit (événements du parcours, indicateurs de `00-vision.md`)
