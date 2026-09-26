# ADR 0005 — Les effets du moteur de règles portent du vocabulaire métier, pas des messages réseau

- Statut : accepté
- Date : 2026-09-16

## Contexte

`docs/02-architecture.md` esquisse la machine d'état du match avec un effet :

```ts
| { type: 'SEND'; to: Seat | 'both'; message: ServerMessage }
```

Or `ServerMessage` est défini dans `@aura/protocol`, et le même document pose que
`@aura/protocol` dépend de `@aura/rules`. Faire porter des messages de protocole aux effets
du moteur créerait donc un **cycle de dépendances** entre les deux packages.

## Décision

Le moteur émet des effets décrits dans son propre vocabulaire :

```ts
type MatchEffect =
  | { type: 'PHASE_STARTED'; phase: Phase; round: number; endsAtMs: number }
  | { type: 'ROUND_RESOLVED'; round: number; result: RoundResult }
  | { type: 'CHOICE_REJECTED'; seat: Seat; reason: ChoiceRejection }
  | { type: 'MATCH_ENDED'; result: MatchResult }
```

C'est le serveur (`apps/server`, module `match`) qui traduit ces effets en messages du
protocole, décide de leur destinataire et applique les règles de confidentialité.

`SCHEDULE_TIMEOUT` disparaît : `PHASE_STARTED` porte déjà `endsAtMs`, qui est l'information
dont le serveur a besoin pour armer son minuteur. Un effet de moins à maintenir.

## Conséquences

- Le sens de dépendance reste `protocol → rules`, sans cycle.
- Le moteur se teste sans rien savoir du réseau : un test de machine d'état n'a besoin ni de
  schéma zod ni de socket.
- **La responsabilité de ne pas fuiter d'information reste entièrement côté serveur.** Le
  moteur produit `ROUND_RESOLVED` avec les deux résultats ; c'est au serveur de n'envoyer à
  chaque siège que ce qu'il a le droit de voir, et seulement après la révélation (règle d'or
  n°4). Cette frontière est un point de relecture obligatoire pour `security-reviewer`.
- `docs/02-architecture.md` garde son esquisse à titre d'intention ; cet ADR fait foi sur la
  forme réelle des effets.
