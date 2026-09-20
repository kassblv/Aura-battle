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
- [ ] Port du rendu 3D du prototype en modules : scène ✅, foule instanciée ✅, rig avec mains ✅, caméra ✅, calque 2D ✅ — **particules et choc : en cours**
- [ ] `AnimationPlayer` lisant `@aura/content` (Catmull-Rom, ressorts, angles, mains) ✅ — **page `/dev/animation-viewer` : non faite** (la galerie de mèmes de l'accueil la remplace pour l'usage courant, pas pour le débogage image par image)
- [x] Client réseau : synchronisation d'horloge, reconnexion automatique, reprise de `match:state`
- [ ] Écrans : accueil ✅ (avec galerie de mèmes jouée par le personnage), créer/rejoindre une invitation ✅, attente ✅, match ✅, résultat ✅ — **revanche : non faite**
- [x] Recharge et timing mesurés avec `performance.now()` et envoyés selon le protocole
- [x] Moteur audio du prototype porté ; musique et effets activables — 23 sons synthétisés, aucun fichier embarqué ; déverrouillé au premier geste (sans quoi iOS reste muet en silence)
- [x] Solo contre IA fonctionnel hors ligne (même `@aura/rules`)
- [ ] Test manuel documenté : le scénario a été joué plusieurs fois (deux origines, `localhost:5173` et `192.168.64.1:5174` — même origine = même identité en localStorage, on ne peut pas rejoindre sa propre invitation) mais **il n'est pas encore écrit dans `docs/09-testing.md`**

## M5 — Classé, matchmaking et fantômes

Référence : `docs/05-matchmaking-ranking.md`.

- [ ] File Redis, worker d'appariement, fenêtre MMR qui s'élargit, `queue:status`
- [ ] MMR (décision Glicko-2 ou Elo consignée en ADR), LP, ligues, placements, saison
- [ ] Enregistrement des fantômes et rejeu serveur ; LP réduits ; drapeau `ghost`
- [ ] Écrans : partie classée, partie rapide, profil (ligue, historique), classement
- [ ] Tests : appariement par MMR, élargissement, bascule vers fantôme, calcul des LP

## M6 — Application mobile

- [ ] Capacitor iOS et Android, icônes, splash, orientation portrait
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
