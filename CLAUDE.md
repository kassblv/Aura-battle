# Aura Battle — mémoire projet

Jeu mobile (iOS/Android) de **duels d'aura en PvP**. Deux joueurs s'affrontent au meilleur des 3 manches. Chaque manche enchaîne une recharge (taper des orbes), un choix secret (mouvement + amplificateur + Ultime), une jauge de timing, puis la révélation et le choc des auras.

Double objectif produit : **sortir vite pendant la tendance « aura »** et **durer au-delà du mème**. Le cœur du jeu (contres, bluff, énergie, timing) ne dépend d'aucun mème : les danses tendance sont des cosmétiques interchangeables.

Le prototype jouable (solo contre IA + duel local) est `prototype/aura-battle.html`. C'est la **référence de ressenti et de rendu**, pas l'architecture cible.

## Règles d'or (non négociables)

1. **Le serveur fait autorité.** Le client n'envoie que des intentions (taps, choix, instants). Le serveur calcule tout : scores, contres, énergie, Ultime, vainqueur. Aucune valeur calculée par le client n'est crue.
2. **`packages/rules` est pur et déterministe.** Pas d'I/O, pas de `Date.now()`, pas de `Math.random()` : le temps et un RNG seedé sont passés en entrée. Même code côté serveur (vérité) et client (prévisualisation).
3. **Aucun avantage payant.** Tout ce qui modifie un score est accessible à tous. La boutique ne vend que du cosmétique (animations, tenues, couleurs d'aura, effets visuels).
4. **Aucune fuite d'information.** Le choix adverse, son timing et ses points de recharge ne sont jamais envoyés avant `round:result`. Seul « l'adversaire a verrouillé » est public.
5. **Le contenu est de la donnée.** Une danse = un fichier JSON validé (`packages/content`). Ajouter une danse ne doit demander aucun changement de code.
6. **Tout changement d'équilibrage** passe par `packages/rules/src/balance.ts`, un test, et une mise à jour de `docs/01-game-design.md`.
7. **Langues :** textes affichés en français (clés i18n), code, identifiants, commits et noms de branches en anglais.

## Stack

- Monorepo **pnpm + Turborepo**, TypeScript strict partout, ESM.
- `packages/rules` : moteur de règles pur. `packages/protocol` : schémas **zod** des messages réseau. `packages/content` : animations et cosmétiques en JSON + validateur.
- `apps/server` : **NestJS** (architecture hexagonale), **Socket.IO** (+ adaptateur Redis), **PostgreSQL/Prisma**, **Redis** (file d'attente, présence, verrous). Logs pino.
- `apps/mobile` : **Vite + React** (écrans) + **Three.js** (arène 3D, modules ES, version récente) + **Capacitor** (iOS/Android, haptique, deep links).
- Tests : **Vitest**, **fast-check** (propriétés), clients Socket.IO de test pour l'e2e, **Testcontainers** (Postgres/Redis).
- Dev local : `docker compose` (Postgres + Redis).

## Carte du dépôt (cible)

```
apps/
  server/        NestJS : modules auth, match, matchmaking, rating, inventory, shop
  mobile/        Vite + React + Three.js + Capacitor
packages/
  rules/         logique de jeu pure + simulateur (pnpm sim)
  protocol/      schémas zod client⇄serveur, version du protocole
  content/       animations JSON, cosmétiques, validateur
docs/            game design, architecture, protocole, roadmap, ADR
prototype/       prototype HTML de référence (ne pas modifier)
.claude/         agents, skills, hooks du projet
```

## Commandes

```bash
pnpm install
docker compose up -d                        # Postgres + Redis
pnpm dev                                    # serveur + client en parallèle
pnpm test                                   # tous les tests
pnpm --filter @aura/rules test              # tests d'un package
pnpm lint && pnpm typecheck
pnpm sim --matches 10000 --strategy all     # simulation d'équilibrage (packages/rules)
pnpm --filter server prisma migrate dev
```

Si une commande n'existe pas encore, c'est qu'elle fait partie d'un jalon à construire (voir la roadmap).

## Façon de travailler

- **Avant chaque tâche**, lis le jalon concerné dans `docs/08-roadmap.md` et le document de référence qu'il cite. Ne lis pas tous les docs d'avance.
- **Plus de 3 fichiers touchés, ou un choix d'architecture :** propose d'abord un plan court et attends la validation.
- **Tests d'abord** pour `packages/rules`, `packages/protocol` et le module `match` du serveur.
- **Petits commits** au format Conventional Commits (`feat(rules): add counter resolution`).
- **Définition de « terminé » :** tests verts, lint et typecheck propres, critères d'acceptation du jalon cochés dans la roadmap, doc mise à jour si le comportement a changé.
- **Décision d'architecture** ⇒ nouvel ADR dans `docs/adr/` (court : contexte, décision, conséquences).
- **En cas de doute sur une règle de jeu**, `docs/01-game-design.md` fait foi. Le prototype sert à comprendre l'intention, pas les valeurs finales.

## Documents de référence (à lire à la demande)

| Sujet | Fichier |
|---|---|
| Vision, cibles, indicateurs | `docs/00-vision.md` |
| Règles PvP chiffrées | `docs/01-game-design.md` |
| Architecture et modules | `docs/02-architecture.md` |
| Protocole temps réel, machine d'état du match | `docs/03-pvp-protocol.md` |
| Modèle de données Prisma | `docs/04-data-model.md` |
| Matchmaking, classement, fantômes | `docs/05-matchmaking-ranking.md` |
| Anti-triche | `docs/06-anti-cheat.md` |
| Format des animations et pipeline de contenu | `docs/07-content-pipeline.md` |
| Jalons et critères d'acceptation | `docs/08-roadmap.md` |
| Stratégie de test et d'équilibrage | `docs/09-testing.md` |
| Décisions d'architecture | `docs/adr/` |

## Agents et skills du projet

- Agents (`.claude/agents/`) : `rules-engineer`, `netcode-engineer`, `client-3d-engineer`, `security-reviewer` (lecture seule), `balance-analyst`.
- Skills : `/next-milestone` (prendre et livrer la prochaine tâche), `/port-prototype` (extraire du prototype), `/add-dance`, `/balance-sim`, `/ship-check` (vérifs avant commit). `pvp-guardrails` se charge automatiquement dès qu'on touche au serveur ou au protocole.
- Délègue une relecture à `security-reviewer` après toute modification de `apps/server/src/match`, `packages/protocol` ou de la validation des taps.

## Pièges connus

### Outillage et versions

- **`latest` n'est pas « stable ».** `pnpm add prisma` installe une *release candidate* de la v8 ; le dépôt est épinglé sur **7.10.0** (ADR 0007). Même logique pour TypeScript : **TS 6**, parce que typescript-eslint refuse TS 7 et qu'on perdrait toutes les règles typées qui protègent l'architecture (ADR 0004).
- **Prisma 7 :** l'URL de connexion ne vit plus dans `schema.prisma` mais dans `prisma.config.ts`, et le client se construit avec un **adaptateur de driver** (`PrismaPg`). Le CLI ne lit plus `.env` tout seul — `prisma.config.ts` le charge via `process.loadEnvFile`.
- **pnpm 11** exige une décision explicite pour chaque dépendance qui veut exécuter du code à l'installation : clé `allowBuilds` dans `pnpm-workspace.yaml`, valeur `true` ou `false`. pnpm réécrit lui-même le fichier avec un `set this to true or false` s'il manque une entrée.
- **NestJS + tsx :** esbuild **n'émet pas `emitDecoratorMetadata`**. Sans `design:paramtypes`, Nest injecte `undefined` en silence, et la panne n'apparaît qu'au premier appel. Tout paramètre de constructeur injecté doit porter un `@Inject(Token)` explicite.
- **`nestjs-pino` est incompatible** avec l'injecteur de Nest 12 : pino est câblé directement dans `shared/logger.ts`.

### Conteneur et déploiement

Le jeu tourne en ligne dans **un seul conteneur** — NestJS sert le client en
plus de son API — déployé par Coolify sur `shipease` (ADR 0012). Six pièges
qui ne se voient qu'en construisant l'image :

- **`prisma generate` exige `DATABASE_URL`** alors qu'il ne touche aucune base :
  `prisma.config.ts` évalue `env()` à l'import. On la donne pour cette seule
  commande, jamais en `ENV` — une URL de construction restée dans l'image serait
  une valeur par défaut crédible et fausse.
- **Le client Prisma est généré au fond du magasin pnpm**, dans un chemin qui
  contient le hachage des dépendances. On le régénère sur l'arbre de production
  plutôt que de coder ce hachage en dur.
- **`pnpm install --prod` par-dessus une installation complète ne réduit rien** :
  pnpm défait les liens, les paquets restent dans `node_modules/.pnpm`, qui
  appartient déjà à la couche précédente. Il faut repartir d'une base propre.
- **pnpm 11 refuse de purger `node_modules` sans terminal** : `CI=true` dans
  l'image, sinon l'étape s'arrête sur une question que personne ne peut lire.
- **Nest pose son propre gestionnaire de 404** pendant `init()`. Un second
  `setNotFoundHandler` fait échouer Fastify au démarrage, donc *après* un
  déploiement annoncé réussi. Le repli de page unique passe par un filtre
  d'exception.
- **Le seed doit tourner à chaque démarrage**, pas une fois à la main : il est
  idempotent, et sans lui un nouvel environnement démarre sans saison, sans
  catalogue et sans vivier de fantômes — les premiers joueurs attendent alors un
  adversaire qui ne vient jamais.

### Développement local

- **Un PostgreSQL natif occupe déjà `127.0.0.1:5432`** sur la machine de développement. Notre conteneur publie donc sur **5433**. Piège : `docker compose ps` affiche fièrement `0.0.0.0:5432->5432/tcp` alors que `localhost` ne l'atteint jamais — macOS résout vers l'installation locale en premier.

### Journalisation

- **`JSON.stringify(new Error('x'))` rend `{}`** : `message` et `stack` ne sont pas énumérables. Un adaptateur de logger naïf avale donc toutes les erreurs en silence, ce qui est pire que pas de journal. `PinoLoggerService` traite les `Error` explicitement.
- La rédaction couvre les secrets **et l'état de match confidentiel** (`choice`, `timing`, `taps`) : un `logger.debug({ choice })` posé pendant un débogage est exactement le genre de fuite qui survit au débogage.

### Anti-triche

- **Un compteur de suspicion se compte par siège, jamais par match.** `docs/06` sanctionne un *joueur*, et ses premières sanctions sont automatiques, avant toute revue humaine. Un compteur commun aux deux sièges attribue à un innocent les mensonges de son adversaire — un tricheur prolifique empoisonnerait le score de chaque personne qu'il croise.
- **Un instant déclaré par le client doit être confronté à son instant d'arrivée.** Sans cela, un bot peut rester muet, recevoir la séquence d'orbes, calculer le programme optimal hors ligne et l'envoyer d'un coup : le moteur rejoue la scène sans rien voir d'anormal. Les tolérances réseau (400 ms sur les taps, 300 ms sur le verrouillage, 250 ms d'horloge) vivent **côté serveur**, jamais dans `@aura/rules` — le moteur doit pouvoir rejouer un match sans entendre parler de latence.
- **Le protocole borne un message, pas la somme des messages.** Un schéma qui accepte 72 taps par paquet ne dit rien du nombre de paquets. Chaque accumulation côté serveur a besoin de sa propre borne.

### Tests temps réel

- **Poser un écouteur au moment où l'on s'intéresse à un message arrive trop tard.** Une phase de match dure quelques dizaines de millisecondes en test : il faut enregistrer avec `onAny` dès la connexion et lire le journal ensuite.
- **Un résultat de tâche mis en cache ment** quand des agents écrivent en parallèle : Turbo peut servir un typecheck calculé avant la dernière édition. `--force` avant de conclure qu'un agent s'est trompé.
- **Chaque scénario doit utiliser des identifiants de joueur distincts.** Le notifier indexe les sockets par joueur et une nouvelle socket remplace l'ancienne — c'est le comportement voulu pour une reconnexion, mais deux tests qui partagent une identité se volent leurs messages.

### Interface et cascade CSS

- **La cascade CSS n'a pas de compilateur.** Un `@media` écrit avant la règle qu'il corrige perd silencieusement. Une classe `.field` ajoutée aux réglages a hérité de l'aire de jeu des orbes — une couche en absolu sur tout l'écran — et posé le champ de saisie par-dessus ses propres titres. **La portée vit dans les noms** : préfixer par le bloc (`account__field`), jamais par le rôle.
- **Un point de bascule `@media` doit tomber du bon côté de l'appareil cible.** `max-width: 860px` renvoyait le format visé — 844×390 — à la mise en page de secours. Un seuil mal placé est pire que pas de seuil.
- **En paysage, la hauteur est la ressource rare et la largeur ne manque pas.** Un panneau de droite qui empile ses sections déborde pendant que la moitié gauche de l'écran ne sert à rien. Les écrans à plusieurs sujets se posent en colonnes (`sheet--wide`, `sheet__cols`) — et rien ne doit défiler au doigt au milieu d'un jeu.
- **Un panneau `.sheet` n'a aucun fond** : il flotte sur l'arène. Dès qu'il défile, son en-tête part et le contenu passe derrière sans rien pour l'en séparer — d'où l'en-tête collant sur la surface du HUD.

### Rendu 3D

- **Horloges :** ne compare jamais une heure client à une heure serveur sans l'offset mesuré par `ping/pong`. Les timings du client sont exprimés **en millisecondes relatives au début de phase**, mesurées avec `performance.now()`.
- **Three.js récent vs prototype (r128) :** `THREE.LuminanceFormat` n'existe plus, utiliser `RedFormat` pour la texture de dégradé toon. Cette texture exige aussi `minFilter` **et** `magFilter` à `NearestFilter` — sans quoi l'interpolation lisse les paliers et l'effet toon disparaît — et doit rester en `NoColorSpace` (c'est une donnée, pas une couleur). `DataTexture` pose déjà ces trois valeurs par défaut : les écrire quand même, **un défaut n'est pas un contrat**. Les textures de couleur peintes au canvas, elles, se marquent `SRGBColorSpace`. `setUsage` et `InstancedMesh.setColorAt` restent valides.
- **Lumières ponctuelles r128 → récent :** `physicallyCorrectLights` a disparu (r155) et l'atténuation en inverse du carré est désormais **permanente**. Le `PointLight(0xffffff, 1, 3.4, 2)` du rig du prototype doit être réétalonné, pas recopié : avec `decay: 2`, le halo sera bien plus violent de près et éteint au-delà d'un mètre. Les lumières **directionnelles et hémisphériques sont inchangées** — vérifié dans les deux versions, ne perdez pas de temps à les « corriger ».
- **Trois.js ne fournit pas ses types** en 0.186 : `@types/three` est nécessaire, à la même version.
- **iOS WebView :** l'`AudioContext` ne démarre qu'après un geste ; la vibration passe par `@capacitor/haptics`, pas `navigator.vibrate`.
- **Mise en arrière-plan mobile :** l'app peut être suspendue en plein match ; la reconnexion doit reprendre l'état via `match:state`.
- **Noms de danses :** ne pas utiliser de nom de personne réelle, de chanson ou de marque dans le contenu publié (voir `docs/07-content-pipeline.md`).
