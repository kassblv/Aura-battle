# 02 — Architecture

## Vue d'ensemble

```
┌────────────── apps/mobile (Capacitor) ───────────────┐
│ React (écrans)   Three.js (arène)   AnimationPlayer  │
│        │                ▲                ▲           │
│        └── match store ─┴── @aura/content┘           │
│                 │  @aura/rules (prévisualisation)     │
└─────────────────┼────────────────────────────────────┘
                  │ Socket.IO (WSS) + REST (HTTPS)
┌─────────────────▼──────── apps/server (NestJS) ──────┐
│ adapters/in : gateway WS, contrôleurs REST           │
│ application : use cases (JoinQueue, LockChoice…)     │
│ domain      : Match (machine d'état) ← @aura/rules   │
│ adapters/out: Prisma repos, Redis queue, clock, rng  │
└──────────┬──────────────────────────┬────────────────┘
       PostgreSQL                    Redis
```

## Monorepo

| Package | Dépend de | Contenu |
|---|---|---|
| `@aura/rules` | rien | Types, `balance.ts`, RNG seedé (ex. mulberry32/xoshiro), génération d'orbes et de jauges, évaluation des taps, résolution d'une manche, machine d'état du match, IA solo, simulateur CLI |
| `@aura/protocol` | `@aura/rules` (types) | Schémas zod des messages, `PROTOCOL_VERSION`, codes d'erreur |
| `@aura/content` | rien | Schéma et fichiers JSON des animations et cosmétiques, validateur, index par mouvement |
| `apps/server` | les trois | API REST + temps réel |
| `apps/mobile` | les trois | Client |

Règle : `@aura/rules` n'importe jamais Node, le DOM, Three.js ou NestJS.

## Moteur de règles : forme attendue

API centrée sur des fonctions pures et une machine d'état explicite :

```ts
type MatchState = { phase: Phase; round: number; seats: Record<Seat, SeatState>; seed: string; history: RoundResult[]; /* … */ };
type MatchEvent =
  | { type: 'PHASE_TIMEOUT'; at: number }
  | { type: 'RECHARGE_TAPS'; seat: Seat; taps: Tap[]; at: number }
  | { type: 'CHOICE_LOCKED'; seat: Seat; choice: Choice; timing: TimingInput; at: number }
  | { type: 'PLAYER_FORFEIT'; seat: Seat; at: number };
type Effect =
  | { type: 'SCHEDULE_TIMEOUT'; phase: Phase; at: number }
  | { type: 'SEND'; to: Seat | 'both'; message: ServerMessage }
  | { type: 'MATCH_ENDED'; result: MatchResult };

function reduce(state: MatchState, event: MatchEvent, config: BalanceConfig): { state: MatchState; effects: Effect[] };
```

Le serveur applique `reduce`, exécute les effets (timers, envois, persistance). Le client peut l'utiliser pour prévisualiser un score, jamais pour décider.

## Serveur (hexagonal)

```
apps/server/src/
  modules/
    auth/          compte invité (appareil), JWT d'accès + refresh, liaison Apple/Google (plus tard)
    match/
      domain/      MatchAggregate (enveloppe @aura/rules), ports (Clock, Rng, MatchRepository, MatchNotifier)
      application/ StartMatch, HandleRechargeTaps, LockChoice, HandleTimeout, Reconnect, Forfeit
      adapters/    MatchGateway (Socket.IO), PrismaMatchRepository, TimerScheduler
    matchmaking/   file Redis, élargissement de la fenêtre MMR, invitations par code, fantômes
    rating/        MMR, ligues, saisons
    inventory/     cosmétiques possédés et équipés
    shop/          catalogue, achats (RevenueCat plus tard)
    challenges/    défis quotidiens
  shared/          config, logger, horloge, erreurs
```

- **Un match vit en mémoire sur un seul nœud** (celui qui l'a créé). Redis garde `match:{id} → nœud` pour router les reconnexions. Les événements sont journalisés pour rejouer un match en cas de litige.
- **Scalabilité :** au lancement, un seul nœud suffit. Ensuite, plusieurs nœuds derrière un équilibreur avec sessions collantes, adaptateur Redis de Socket.IO, et attribution des matchs par verrou Redis.
- **Persistance :** résultat de match, manches et journal d'événements écrits à la fin du match (et un instantané Redis à chaque fin de manche pour survivre à un redémarrage).

## Client

```
apps/mobile/src/
  app/            routes : Accueil, File d'attente, Match, Résultat, Boutique, Profil, Solo
  net/            client Socket.IO, synchronisation d'horloge, reconnexion, file de messages
  match/          store du match (Zustand), mapping messages → état d'écran
  arena/          scène Three.js : stage, crowd, rig, hands, particles, camera, clash, overlay 2D
  animation/      AnimationPlayer : lit @aura/content, Catmull-Rom, ressorts, mains
  audio/          moteur WebAudio du prototype
  platform/       Capacitor : haptique, deep links, cycle de vie, partage
```

- L'arène est pilotée par des **événements de match** (`reveal(left)`, `clash(result)`, `victory(seat)`), jamais par des calculs de score locaux.
- Budget performance : 60 i/s sur un milieu de gamme de 2022, 30 i/s minimum. Niveaux de qualité : foule (270 / 120 / 0 spectateurs), doigts (détaillés en gros plan uniquement), particules (3 000 / 1 500 / 700).

## Environnements

| Environnement | Hébergement suggéré |
|---|---|
| Local | docker compose |
| Préproduction et production | Région Paris ou Europe de l'Ouest (Scaleway, Fly.io `cdg`, Railway), Postgres managé, Redis managé |
| Observabilité | pino + OpenTelemetry, Sentry (serveur et mobile) |
