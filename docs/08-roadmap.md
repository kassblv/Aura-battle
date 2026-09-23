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
- [x] **Paysage exclusif** (ADR 0008) : écran « tourne ton téléphone » ✅, commandes dans les arcs de pouce ✅, rien d'interactif au centre haut ✅, cibles tactiles ≥ 46 px ✅, verrouillage par l'API `screen.orientation` ✅, **verrouillage natif ✅** — imposé au manifeste Android et à l'`Info.plist` iOS, donc avant tout JavaScript (voir M6)
- [x] Port du rendu 3D du prototype en modules : scène ✅, foule instanciée ✅ (avec les téléphones braqués), rig avec mains ✅, caméra ✅, calque 2D ✅, **choc des auras ✅** (`clash.ts`, piloté par `director.ts` et dessiné dans le puits à particules), **particules d'aura ✅** — un émetteur et un voile par siège, branchés dans `scene.ts` et alimentés par `useArena`. L'intensité vient de trois sources et **jamais du choix secret** : valeur de repos hors match, `hype` (dérivée de la seule phase, donc identique aux deux sièges) avant la révélation, et `director.auraWeight(seat)` pendant le choc, une fois les deux choix publics. La garantie tient dans la signature de `AuraDrive`, qui n'a aucun champ propre à un siège. **Effet d'aura : livré.** Le catalogue, la vente serveur, le protocole et le
rendu existaient ; ce qui manquait était le chemin entre eux — et un trou de
sécurité au milieu. Un skin payant habille désormais **un** amplificateur, le
serveur le résout seul, et la boutique les vend. Détail dans « Effets d'aura : la chaîne cassée » ci-dessous.
- [ ] `AnimationPlayer` lisant `@aura/content` (Catmull-Rom, ressorts, angles, mains) ✅ — **page `/dev/animation-viewer` : non faite** (la galerie de mèmes de l'accueil la remplace pour l'usage courant, pas pour le débogage image par image)
- [x] Client réseau : synchronisation d'horloge, reconnexion automatique, reprise de `match:state`
- [x] Écrans : accueil ✅ (avec galerie de mèmes jouée par le personnage), créer/rejoindre une invitation ✅, attente ✅, match ✅, résultat ✅, revanche ✅ — en solo elle relance une partie sur une nouvelle graine, en ligne elle remet en file (l'adversaire précédent n'a aucune raison d'être encore là)
- [x] Recharge et timing mesurés avec `performance.now()` et envoyés selon le protocole
- [x] Moteur audio du prototype porté ; musique et effets activables — 23 sons synthétisés, aucun fichier embarqué ; déverrouillé au premier geste (sans quoi iOS reste muet en silence)
- [x] Solo contre IA fonctionnel hors ligne (même `@aura/rules`)
- [x] Test manuel documenté : `docs/09-testing.md`, § « Test manuel : un duel à deux navigateurs » — sept étapes, avec le piège des deux onglets d'une même origine qui partagent la même identité

### Effets d'aura : la chaîne, et où elle était cassée

Vérifié pièce par pièce sur le code et sur le client en marche. Le modèle est
posé par `docs/01-game-design.md` § 3 : un amplificateur **s'affiche sous le nom
de son effet offert**, et « Flammes, Onde de choc, Aura noire deviennent des
skins cosmétiques **d'un niveau** ».

| Maillon | État |
|---|---|
| Catalogue (`AURA_EFFECTS`) | ✅ 8 effets — 5 offerts (un par niveau d'amplificateur), 3 skins payants aux niveaux A1, A2, A3 |
| Amorçage et vente serveur | ✅ `AURA_EFFECT` est un `PURCHASABLE_KINDS`, les effets sont dans le catalogue amorcé |
| Protocole | ✅ `round:result` porte `cosmetic.effectId` **par siège** — le seul endroit où les deux apparaissent |
| Serveur : effet de révélation | ✅ `cosmeticOf` résout depuis le **palier réellement joué** et ce que le joueur possède (`effectForLevel`), lu à la connexion et figé pour le match |
| Serveur : possession | ✅ Le champ `cosmetic` **n'existe plus** dans `choice:lock`. Il n'y a plus de valeur à vérifier : le client ne la fournit pas. Règle d'or n°1 |
| Client : rendu à la révélation | ✅ `auraEffectId` traverse la présentation, sous **exactement** la même garde que l'animation — donc absent avant `round:result`, règle d'or n°4 |
| Boutique | ✅ Rayon « Effets d'aura · un amplificateur chacun » : Flammes (A1, 400), Onde de choc (A2, 850), Aura noire (A3, 850) |
| Vestiaire | — Sans objet : posséder un skin, c'est le porter au niveau qu'il habille. Il n'y a qu'un skin payant par niveau, donc rien à choisir |

**Le solo aussi**, depuis que `packages/rules` retient l'amplificateur joué
(`SeatState.amplifiers`, aligné sur `moves`, un par manche y compris pour celui
qui n'a rien verrouillé). Le moteur gardait le mouvement et jetait
l'amplificateur : en ligne cela ne se voyait pas, le serveur tient les choix
verrouillés — hors ligne personne ne s'en souvenait. `present()` résout donc
l'effet comme le serveur le fait, sous la même garde que l'animation, et l'IA
ne se voit pas prêter l'inventaire du joueur.

**Reste** : le vestiaire ne permet pas de *revenir* à l'effet offert quand on a
acheté le skin de ce niveau. Personne ne l'a demandé, et un chooser à une seule
option ne se conçoit pas — à rouvrir le jour où un second skin habillera le même
amplificateur.

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
  reconnexion. Le vivier est **amorcé au seed** à partir des quatre profils de l'IA solo
  (39 enregistrements, 13 niveaux de MMR) : sans cela la fonctionnalité ne marchait pas le
  jour du lancement, quand la file est vide. Un enregistrement humain est toujours préféré à
  un enregistrement amorcé, ce qui retire ces derniers à mesure que le vivier réel se
  remplit. Le client affiche « Adversaire en différé » ✅.
- [x] Écrans : partie classée ✅ et partie rapide ✅ (choix sur l'accueil, `queue:join` émis avec le mode), profil affichant la ligue, les LP, les matchs joués, les victoires et les séries ✅ — chaque chiffre est **compté** depuis un `match:end` confirmé, jamais estimé. **Classement général ✅** : `GET /leaderboard`, les cinquante premiers **et** sa propre place, parce que la question qu'on se pose en ouvrant un classement est « où suis-je », pas « qui est premier ». Le rang vient de Postgres (`row_number()` sur l'index `(seasonId, leaguePoints)`), avec un **départage explicite** sur `playerId` — sans lui, deux joueurs à égalité changent de place d'un rafraîchissement à l'autre, et un classement où l'on monte et descend sans rien faire ne se croit plus. Voisinage et rang numérotés en **une seule requête** : deux requêtes pourraient tomber de part et d'autre d'un match qui s'achève et rendre un joueur absent de son propre voisinage. Un joueur sans match classé n'a pas de rang inventé.
- [x] Tests : appariement par MMR ✅, élargissement ✅, entrée/sortie de file et tickets fantômes ✅ (e2e à deux clients), bascule vers fantôme ✅ (`ghost-e2e.test.ts` : un duel humain est enregistré puis rejoué contre un joueur seul), sélection de fantôme en propriétés `fast-check` ✅, LP réduits ✅, vivier d'amorçage ✅ (couverture de la plage de MMR vérifiée en propriété, et scénario « premier joueur du jeu » en e2e)

## En ligne — version jouable déployée

Hors jalon : demandé en cours de route, et livré avant M6 parce qu'une version
joignable depuis un téléphone rend tout le reste vérifiable.

- [x] Image de production : **un seul conteneur**, NestJS sert le client en plus de son API (ADR 0012). Aucune URL dans le build — le client parle à l'origine qui l'a servi, donc la même image tourne derrière n'importe quel domaine.
- [x] Pile Coolify (`docker-compose.prod.yml`) : `app` + `postgres` + `redis`, seul `app` exposé par Traefik. Migrations **et amorçage** au démarrage du conteneur — sans le seed, un nouvel environnement démarre sans vivier de fantômes et les premiers joueurs attendent un adversaire qui ne vient jamais.
- [x] Déployé et vérifié de bout en bout : HTTPS valide, WebSocket à travers Traefik, un duel complet contre un fantôme.
- [x] **Code de récupération** (`AuthProvider.RECOVERY`) : un compte invité vit dans le stockage du navigateur, qui se vide pour un rien sur ordinateur. Seize symboles Crockford, quatre-vingts bits, haché côté serveur. Le présenter ne le consomme pas, en redemander un révoque l'ancien, et le rattachement d'appareil qui suit fait que la récupération survit au rechargement. Voir `docs/04-data-model.md`.
- [ ] **Multi-nœuds** : une seule réplique pour l'instant, l'adaptateur Redis de Socket.IO n'est pas câblé (deuxième moitié de M7).
- [x] **Déploiement automatique au push** : webhook GitHub → Coolify, signature HMAC, vérifié par un commit vide qui a bien déclenché une mise en ligne. L'API générale de Coolify reste **désactivée** — elle n'est plus nécessaire. Voir `docs/10-exploitation.md`.
- [x] **Sauvegarde de la base** : `pg_dump` quotidien à 3 h 30 UTC, 14 jours de rétention, et une **restauration vérifiée** dans une base jetable — 12 joueurs et 1 identité de récupération identiques des deux côtés. Voir `docs/10-exploitation.md`. **Reste : une copie hors de la machine** — ceci protège d'une bêtise, pas de la perte du serveur.
- [x] **Panneau d'administration** (`/admin`) : état des composants, chiffres du jeu, commit déployé, erreurs des 24 h. **En lecture seule** — aucune route n'écrit. Secret dans l'environnement, hors de la table des joueurs ; sans lui le panneau rend 404 plutôt que « interdit ». Voir `docs/10-exploitation.md`.
- [ ] **Alerte** : le panneau se regarde, il ne prévient pas. Un workflow de veille est écrit (`.github/workflows/veille.yml`, sonde `/health` **et** `/admin/status`, un seul incident commenté puis refermé) mais **il ne tourne pas** : les cent dernières exécutions d'Actions ont échoué sur ce compte, sans une seule étape exécutée. Repli identifié : une sonde sur `devisia`, machine distincte et joignable. Reste à choisir par où l'alerte arrive.

## M6 — Application mobile

- [x] Capacitor iOS et Android, splash, **verrouillage en paysage** (ADR 0008 ; cette ligne disait « orientation portrait », écrite avant l'ADR). Capacitor 8.5.2 épinglé, projets natifs générés et versionnés. Le paysage est imposé **avant tout JavaScript** : `sensorLandscape` au manifeste Android, portrait retiré de l'`Info.plist` iOS — le verrou logiciel du client ne sert plus qu'au navigateur. Splash effacé quand le *jeu* est prêt, avec un délai maximal de 6 s : un écran de démarrage qu'on efface à la main est un écran qui peut ne jamais s'effacer, et c'est une panne muette. **Non fait : les icônes** (`cap assets` demande une source que personne n'a encore dessinée).
- [x] Haptique (`@capacitor/haptics`), cycle de vie (arrière-plan ⇒ reconnexion). Le toucher **double** le son, il ne le remplace pas : `hapticFor` ne retient que les faits qui pèsent — orbe dorée, tap raté, verrouillage, choc, Ultime, fin de match — avec un plancher de 90 ms entre deux vibrations, sans quoi le moteur empile trois coups en un bourdonnement. **Règle d'or n°4 : le toucher est un canal comme un autre**, donc rien de la révélation adverse ne se sent. Au retour au premier plan, `client.wake()` force la vérification de la socket — une WebView suspendue en laisse une qui se croit ouverte pendant que le serveur a fermé — et la reprise passe par le chemin habituel `match:rejoin` → `match:state`.
- [ ] Deep links et universal/app links pour les invitations — le schéma `aurabattle://` fonctionne des deux côtés, et `deepLinkWatcher` lit un lien ouvert alors que le jeu tourne déjà (il n'arrive **pas** par l'adresse de la page : la WebView ne navigue pas). **Non fait : les liens https vérifiés** — Android attend `/.well-known/assetlinks.json` sur le domaine, iOS un `apple-app-site-association` plus la capacité « Associated Domains » dans Xcode. Sans eux, un lien https ouvre le navigateur au lieu du jeu.
- [x] Niveaux de qualité graphique automatiques (foule, doigts, particules, pixel ratio) et réglage manuel — trois paliers dans `apps/mobile/src/platform/quality.ts`, **qui est la source** des constantes de l'arène (`MAX_PIXEL_RATIO`, `CROWD_SIZE`, les capacités de particules en découlent, un test le vérifie). La mesure compte les images au-dessus de 33 ms sur une fenêtre de 240 ; au-delà de 10 %, une descente est **préparée** et n'est appliquée qu'à une frontière de manche — jamais pendant la jauge, où le timing du joueur est mesuré. La qualité **ne remonte jamais seule** : l'écran Réglages (4ᵉ bouton du rail) permet `auto` / Beau / Équilibré / Fluide, et nomme en `auto` le palier réellement appliqué, sans quoi une descente silencieuse se lit comme une panne. Le réglage et le palier trouvé sont mémorisés. Rien n'est alloué ni libéré pour changer de palier : la foule garde ses `InstancedMesh` et les tampons de particules leur taille, seul le nombre d'éléments **lus** change. Les places sont triées par importance à l'écran, donc une descente retire les derniers rangs et **jamais le premier cercle**. **Non fait : le réglage par appareil connu** (aucune table de modèles — c'est une mesure réelle, pas une devinette).
- [ ] Budget : 60 i/s visés, 30 i/s minimum sur appareil milieu de gamme ; mesure documentée
- [ ] Builds de test : TestFlight et piste interne Google Play — **hors de portée d'ici** : il faut Xcode, Android Studio et des comptes développeur. Tout est prêt à compiler : `pnpm --filter mobile build && npx cap sync`, puis `npx cap open ios` ou `npx cap open android`.

---

## Phase 2 — Durer

### M7 — Anti-triche et robustesse
- [ ] Contrôles de cohérence temporelle et plafonds (voir `06-anti-cheat.md`)
- [ ] Job de détection statistique + `SuspicionFlag` + sanctions progressives
- [x] Test de charge : 500 matchs simultanés sur un nœud, p95 de traitement d'un message < 20 ms — **0,50 ms** mesurée (`apps/server/bench`, relevés dans `docs/09-testing.md`, ADR 0011)
- [ ] Multi-nœuds : adaptateur Redis, sessions collantes, reprise d'un match après redémarrage d'un nœud (instantané de fin de manche)

### M8 — Méta et monétisation cosmétique
- [x] **Inventaire et loadout côté serveur.** La boutique et le portefeuille vivaient dans `localStorage` — un inventaire qu'on s'offrait soi-même, perdu en changeant d'appareil ; avec le code de récupération, garder son compte sans garder ses achats n'avait plus de sens. Trois routes HTTP (`GET /inventory`, `POST /inventory/buy`, `PUT /inventory/loadout`), la règle d'achat pure avec `PURCHASABLE_KINDS` comme **garde** de la règle d'or n°3, et **deux gardes de concurrence** : la clé primaire `(playerId, itemId)` pour deux achats du même objet, le débit conditionnel pour deux objets différents payables séparément mais pas ensemble. Le serveur **crédite** enfin la récompense qu'il annonçait depuis M5. L'**effet d'aura est équipable** : `AURA_STYLES` attendait un porteur depuis le portage des particules. **Migration : la bourse repart de zéro** (elle se créditait elle-même, elle n'a jamais rien valu), tout ce qui est gratuit est accordé à tous, et l'apparence est conservée pour ce que le joueur possède. La teinte de peau reste locale — ce n'est pas un cosmétique. La **vitrine du jour** est faite (voir `docs/01` §11) : trois articles à −30 %, sur un cycle de cinq jours qui garantit que rien ne se répète d'un jour sur l'autre et que tout passe une fois par tour. La remise est facturée **par le serveur**, avec son jour — vérifié en vrai : 112 débités pour un article en vitrine à 160, 80 pour un article hors vitrine à 80. **Reste : la monnaie dure**, qui s'achète (`docs/01` §11) et attend donc les achats intégrés ; elle ne s'affiche plus tant qu'elle ne veut rien dire.
- [x] **Défis quotidiens** (`docs/01` §11). Le catalogue est de la **donnée** (dix
  défis, règle d'or n°5) ; la sélection du jour est **déterministe depuis le numéro
  du jour UTC**, donc rien n'en est stocké et un redémarrage ne change pas la
  journée en cours. Trois défis, jamais deux fois la même mesure.

  **La progression avance à la fin de chaque MANCHE, pas du match** : les chiffres
  de recharge vivent dans `pending`, effacé au tour suivant — les compter plus tard
  les compterait à zéro, et deux défis sur cinq deviendraient infinissables sans
  qu'aucune erreur ne soit levée. La **victoire**, elle, se compte une fois à la
  fin : par manche, « gagner un duel » serait payé trois fois pour une partie.

  **L'encaissement marque puis crédite, en une transaction**, et le marquage vient
  en premier — l'inverse d'un achat. Ici c'est le double paiement qu'on redoute :
  un défi marqué sans crédit se voit et se corrige, un crédit doublé ne se remarque
  jamais. `updateMany` conditionné sur `claimedAt IS NULL`, et le service croit le
  refus de la base plutôt que sa propre lecture. Vérifié contre Postgres : bourse
  0 → 50 au premier encaissement, 50 et `ALREADY_CLAIMED` au second.

  Écran en trois colonnes, sixième case du rail avec une pastille, et **annonce en
  fin de match** : le moment où un défi tombe est celui où le joueur sort de sa
  partie, pas son prochain passage par un écran qu'il n'a aucune raison d'ouvrir.
  La comparaison porte sur deux photos prises par le serveur (`newlyCompleted`),
  jamais sur une progression calculée ici.

  **Les défis n'avancent qu'en duel en ligne**, et l'écran le dit. Le serveur ne
  voit jamais une partie solo : un résultat annoncé par le client rendrait le défi
  déclaratif, ce que « validés côté serveur » interdit. Sans cette phrase, un
  joueur enchaînerait des solos devant des compteurs immobiles et conclurait à une
  panne.
- [ ] Passe de saison (gratuit + premium)
- [ ] Achats intégrés via RevenueCat, reçus validés côté serveur

### M9 — Partage
- [ ] Spike : export d'un clip vertical de la révélation (MediaRecorder sur le canvas ou rendu serveur), choix en ADR
- [ ] Partage natif, lien d'invitation intégré au clip

### M10 — Live-ops
- [ ] Feature flags, événements de règles en données, bulle d'intention en test A/B
- [ ] Contenu servi avec `contentVersion` et cache client
- [ ] Analytics produit (événements du parcours, indicateurs de `00-vision.md`)
