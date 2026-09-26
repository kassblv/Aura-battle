# 03 — Protocole PvP temps réel

Transport : **Socket.IO sur WSS**. Authentification au handshake avec le JWT d'accès (`auth: { token }`). Tous les messages sont validés par les schémas zod de `@aura/protocol`, dans les deux sens. Un message invalide est ignoré et journalisé.

## Principes

- Le serveur fait autorité sur le temps : chaque échéance est un `endsAt` en **heure serveur** (ms epoch).
- Le client mesure son offset d'horloge avec `ping/pong` (médiane des 5 dernières mesures) et convertit `endsAt` en heure locale pour l'affichage.
- Les instants saisis par le client (taps, charge, tap de timing) sont en **ms relatives au début de la phase côté client**, mesurés avec `performance.now()`.
- Chaque message de match porte `matchId` et `round`. Les messages d'une manche passée sont ignorés.
- Chaque action client porte un `seq` croissant. Le serveur rejette les doublons (idempotence en cas de renvoi après reconnexion).

## Machine d'état du match

```
            both ready / 10 s
CREATED ─────────────────────▶ ROUND_INTRO (2 s)
                                   │
                                   ▼
                               RECHARGE (6 s + 400 ms de tolérance)
                                   │
                                   ▼
                               CHOICE (≤ 15 s ; fin anticipée si les deux ont verrouillé)
                                   │
                                   ▼
                               REVEAL (4,5 s)
                                   │
                    ┌──────────────┴──────────────┐
          match non terminé                 match terminé
                    │                             │
                    ▼                             ▼
               ROUND_INTRO                    ENDED
```

`ENDED` est aussi atteint immédiatement sur forfait ou déconnexion définitive.

## Messages client → serveur

| Événement | Charge utile | Phase | Notes |
|---|---|---|---|
| `ping` | `{ t }` | toutes | `t` = `performance.now()` client |
| `queue:join` | `{ mode: 'ranked' \| 'casual' }` | hors match | |
| `queue:leave` | `{}` | file | |
| `invite:create` | `{}` | hors match | Réponse `invite:created { code, deepLink, expiresAt }` |
| `invite:join` | `{ code }` | hors match | |
| `match:ready` | `{ matchId }` | CREATED | Assets chargés |
| `match:rejoin` | `{ matchId }` | toutes | Après reconnexion ; réponse `match:state` |
| `recharge:taps` | `{ matchId, round, seq, taps: { orbIndex, t }[] }` | RECHARGE | Envoi groupé toutes les 500 ms et à la fin |
| `choice:lock` | `{ matchId, round, seq, poseId, amp, ult, timing: { chargeAt, tapAt \| null } }` | CHOICE | Un seul verrouillage par manche. Depuis la **2.0.0**, le client ne dit que la **pose** : le serveur en déduit famille et palier (`moveOfAnimation`) |
| `intent:show` | `{ matchId, round, seq, style }` | CHOICE | Seulement si le match porte `intentBubble` (2.6.0). **Une seule annonce par manche** : la première fait foi, les suivantes sont ignorées, et toute annonce postérieure à `choice:lock` est refusée. Un refus ne produit **aucun** message |
| `emote:send` | `{ matchId, emoteId }` | toutes | Limité à 1 toutes les 3 s |
| `match:forfeit` | `{ matchId }` | toutes | |

## Messages serveur → client

| Événement | Charge utile |
|---|---|
| `pong` | `{ t, serverTime }` |
| `queue:status` | `{ mode, elapsedMs, searchRange }` |
| `match:found` | `{ matchId, seat: 'left' \| 'right', opponent: { displayName, league, cosmetics }, protocolVersion, rulesVersion, contentVersion, ghost: boolean, rulesVariant? }` (2.4.0 : variante de la semaine, partie rapide seulement) |
| `round:intro` | `{ matchId, round, endsAt, roundsWon, energy, ult }` |
| `recharge:start` | `{ matchId, round, startsAt, endsAt, orbs: OrbSpec[] }` — séquence identique pour les deux joueurs |
| `choice:start` | `{ matchId, round, endsAt, meter: { period, zone, perfect, center }, energy, ult, shiny? }` — `energy`, `ult` et `shiny` (sa case brillante) du destinataire uniquement |
| `opponent:locked` | `{ matchId, round }` |
| `intent:shown` | `{ matchId, round, seat, style }` — envoyé aux **deux** sièges : l'adversaire y lit la bulle, l'annonceur sa confirmation (2.6.0) |
| `round:result` | voir ci-dessous |
| `match:end` | `{ matchId, winner: Seat \| null, reason: 'rounds' \| 'tiebreak' \| 'forfeit' \| 'disconnect', rating: { before, after, leagueBefore, leagueAfter }, rewards }` |
| `match:state` | Instantané complet pour reprise après reconnexion. Porte `ghost: boolean` et rappelle `opponent` : le drapeau d'honnêteté de `match:found` doit survivre à une application tuée en arrière-plan |
| `emote:received` | `{ seat, emoteId }` |
| `error` | `{ code, message, retryable }` |

### `round:result`

```ts
{
  matchId: string; round: number;
  sides: Record<Seat, {
    move: { style: Style; tier: Tier }; amp: AmpLevel; ult: boolean;
    cosmetic: { animationId: string; effectId: string };
    recharge: { points: number; bestCombo: number; boostPct: number; ultGain: number; energyGain: number };
    timing: { quality: 'perfect' | 'good' | 'miss'; error: number };
    repeat: boolean; counter: boolean; countered: boolean; counterBlocked: boolean;
    base: number; final: number;
    energyAfter: number; ultAfter: number;
  }>;
  winner: Seat | null;
  roundsWon: Record<Seat, number>;
  timeline: { revealFirst: Seat }; // ordre de révélation pour la mise en scène
}
```

C'est le **premier** message qui contient les choix de l'adversaire.

## Validation serveur

| Donnée | Règle |
|---|---|
| `recharge:taps` | Reçu avant `endsAt + 400 ms` ; `t` croissants ; `t ∈ [0, 6000]` ; orbe vivante à `t` selon la séquence ; au plus 12 taps/s ; une orbe ne compte qu'une fois |
| `choice:lock` | Phase CHOICE, avant `endsAt + 300 ms` ; `poseId` = une pose de mouvement du catalogue, sinon refus `INVALID_PAYLOAD` au seul siège fautif, compté dans ses événements refusés ; une pose valide mais **ni offerte ni possédée** verrouille quand même son mouvement avec la **pose offerte de la case** et vaut au joueur un simple avertissement `COSMETIC_NOT_OWNED`, sans suspicion — un achat cosmétique ne doit jamais coûter une manche ; coût ≤ énergie ; `ult` seulement si jauge pleine ; `chargeAt ≥ 0` ; `tapAt − chargeAt ∈ [120, 6000]` ms ; `tapAt` cohérent avec l'heure de réception (écart ≤ RTT mesuré + 250 ms) |
| `intent:show` | Phase CHOICE, avant `choice:lock` du même siège, **une seule annonce par manche et par siège** — sans quoi annoncer toutes les familles garantit le bonus de +10 de jauge d'Ultime de `01-game-design.md` §10 |
| Tout message | Schéma zod, joueur bien assis dans ce match, `seq` non déjà traité, limite de débit par socket |

## Délais, déconnexions et reconnexion

- Déconnexion : le match continue. Les échéances s'appliquent et les actions par défaut sont jouées (voir game design §9).
- Reconnexion dans les **45 s** : le client se reconnecte avec le même JWT, envoie `match:rejoin { matchId }`, reçoit `match:state` puis reprend.
- Au-delà de 45 s cumulées, ou deux manches consécutives sans action : forfait.
- Passage de l'app en arrière-plan : le client ferme proprement la socket et se reconnecte au retour (ne pas compter sur la socket survivante).

## Versions

- `PROTOCOL_VERSION` (semver) dans `@aura/protocol`. Major différent ⇒ `error { code: 'CLIENT_OUTDATED' }` et écran de mise à jour.
- **2.0.0** (2026-09-24) : `choice:lock.move` remplacé par `poseId`, familles passées de 3 à 5 (ADR 0014). Un client 1.x est renvoyé sur l'écran de mise à jour dès la connexion.
- **2.1.0** (2026-09-24) : la carte brillante. Deux champs sont ajoutés, facultatifs et donc compatibles :
  - `choice:start.shiny: { style, tier }`, la case du **destinataire** seulement ;
  - `round:result.sides.*.shiny: boolean`.
- **2.2.0** (2026-09-25) : la monnaie choisie à l'achat. `POST /inventory/buy` accepte `currency: 'soft' | 'hard'`, facultatif. C'est une **monnaie**, jamais un montant : le prix reste celui du catalogue du serveur. Choisie, elle est la seule prélevée ; absente, le serveur garde le comportement 2.1 (les pièces d'abord). Voir l'ADR 0015.
- **2.3.0** (2026-09-25) : le passe de saison, en HTTP authentifié (jeton Bearer), limité en débit par joueur (429 `RATE_LIMITED`). Chaque route rend l'état complet `SeasonState` (`seasonStateSchema`) : `season` (`{ number, endsAt }` ou `null` hors saison), `xp`, `tier`, `premium`, `claimed`, `wallet`. Les récompenses sont du contenu (`SEASON_PASS`), jamais envoyées par le serveur.
  - `GET /season`.
  - `POST /season/claim` `{ tier, track }` (strict : aucun montant). Refus : 400 `INVALID_PAYLOAD`, 403 `TIER_LOCKED` / `PREMIUM_REQUIRED`, 404 `UNKNOWN_TIER` / `NO_SEASON`, 409 `ALREADY_CLAIMED`.
  - `POST /season/claim-all` : tout ce qui est atteint et pas réclamé, sur les pistes du joueur, en une transaction. 404 `NO_SEASON`.
  - `POST /season/premium` : débite 500 jetons et ouvre la piste. 403 `INSUFFICIENT_FUNDS`, 409 `ALREADY_PREMIUM`, 404 `NO_SEASON`.
- **2.4.0** (2026-09-25) : les événements de la semaine. `match:found.rulesVariant` est ajouté, facultatif : l'identifiant d'une variante de `RULE_VARIANTS` (`@aura/rules`), jamais ses valeurs. Absent, les règles normales. (Un client 2.3 ne l'ignore PAS : il analysait en strict et refuse le message — voir 2.4.1.) Le serveur le décide à l'ouverture, en heure serveur (semaine UTC, lundi), pour la **partie rapide seulement**, fantôme compris ; classé et invitation n'en portent jamais. Le match joue la config de la variante de bout en bout (moteur, échéances, fantôme), et son `Match.rulesVersion` en base la porte en métadonnée semver (`1.0.0+ultime`) pour que le rejeu sache sous quelles règles rejouer. 
- **2.4.1** (2026-09-26) : `match:state.rulesVariant`, facultatif : la variante survit à une reprise. **Et le client ignore désormais les clés inconnues** des messages serveur comme des réponses HTTP (`lenient`, `@aura/protocol`) : un champ ajouté ne casse plus un client installé. Le serveur, lui, émet toujours par les schémas stricts (`serializeServerMessage`) — c'est là que vit la règle d'or n° 4. Un client antérieur à 2.4.1 reste fragile face à toute addition.
- **2.5.0** (2026-09-26) : `POST /events` `{ kind: 'clip_shared', matchId }` (`productEventSchema`, strict), authentifié, limité en débit par joueur (429 `RATE_LIMITED`). Réponse **204** dans tous les cas acceptés, que le joueur ait siégé dans ce match ou non : la route ne dit rien à qui sonde. Le serveur n'inscrit l'événement que si le joueur a occupé un siège du match, une fois par (joueur, match, sorte). Envoyé par le client après un partage ou un téléchargement du clip, jamais relancé.
- **2.6.0** (2026-09-26) : la bulle d'intention en test A/B (spec `2026-09-26-bulle-intention-ab-design`). Champs facultatifs : `match:found.intentBubble: true`, `match:state.intentBubble: true`, `match:state.intents: { a?, b? }`, `round:result.sides.*.intentKept: boolean`. **Exposition**, décidée par le serveur à l'ouverture : partie rapide et invitation seulement, jamais le classé, et seulement si **tous les sièges réels** sont dans le groupe exposé du drapeau `intentBubble` (module `flags`) — le siège d'un fantôme ne compte pas, et le fantôme n'annonce jamais. Absent, `intent:show` est ignoré en silence et aucun des champs n'apparaît : un joueur témoin reçoit exactement les messages d'avant. **Relais** : `intent:show` passe les mêmes filtres que tout message de match (débit, schéma, siège, manche en cours, `seq` neuf) ; le moteur décide du reste (bulle active, phase CHOICE, pas encore verrouillé, première annonce) et, s'il accepte, `intent:shown` part aux **deux** sièges. L'annonce est journalisée avec le match (le rejeu en a besoin : elle vaut +10 de jauge). **Reprise** : `match:state.intents` rappelle les annonces de la manche en cours, des deux sièges — publiques par nature, `intent:shown` les a déjà diffusées ; omis si personne n'a annoncé. **Révélation** : `intentKept` est présent (vrai ou faux) dans chaque `side` dès que la bulle est active, absent sinon — vrai quand le siège gagne la manche avec la famille annoncée, et `ultAfter` porte alors le bonus.
- La charge d'authentification du handshake est elle aussi décrite par un schéma : `handshakeAuthSchema` = `{ token, protocolVersion }`, strict et borné. C'est le seul point d'entrée dont un abus précède toute vérification métier.
- `rulesVersion` et `contentVersion` sont envoyés dans `match:found`. Le serveur ne mélange jamais deux versions de règles dans un même match.

## Codes d'erreur

`UNAUTHORIZED`, `CLIENT_OUTDATED`, `NOT_IN_MATCH`, `WRONG_PHASE`, `DEADLINE_PASSED`, `INVALID_PAYLOAD`, `NOT_ENOUGH_ENERGY`, `ULT_NOT_READY`, `ALREADY_LOCKED`, `COSMETIC_NOT_OWNED`, `RATE_LIMITED`, `INVITE_NOT_FOUND`, `INVITE_EXPIRED`, `ALREADY_IN_QUEUE`, `ALREADY_IN_MATCH`.

## Exemple de manche (du point de vue de `left`)

```
S→C round:intro      { round: 1, endsAt: T+2000, roundsWon: {left:0,right:0}, energy: 14, ult: 0 }
S→C recharge:start   { startsAt: T+2000, endsAt: T+8000, orbs: [...] }
C→S recharge:taps    { seq: 1, taps: [{orbIndex:0,t:412},{orbIndex:2,t:780}] }   (toutes les 500 ms)
S→C choice:start     { endsAt: T+23400, meter: {period:1720, zone:.22, perfect:.08, center:.41}, energy: 14, ult: 32 }
S→C opponent:locked  { round: 1 }
C→S choice:lock      { seq: 9, poseId:'anim.provoc.t2.mewing', amp:1, ult:false, timing:{chargeAt:3100, tapAt:4012} }
S→C round:result     { ... }
S→C round:intro      { round: 2, ... }
```
