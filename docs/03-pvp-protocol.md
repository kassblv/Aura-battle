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
| `choice:lock` | `{ matchId, round, seq, move: { style, tier }, amp, ult, cosmetic?: { animationId, effectId }, timing: { chargeAt, tapAt \| null } }` | CHOICE | Un seul verrouillage par manche |
| `intent:show` | `{ matchId, round, seq, style }` | CHOICE | Seulement si le flag de bulle d'intention est actif. **Une seule annonce par manche** : la première fait foi, les suivantes sont ignorées, et toute annonce postérieure à `choice:lock` est refusée |
| `emote:send` | `{ matchId, emoteId }` | toutes | Limité à 1 toutes les 3 s |
| `match:forfeit` | `{ matchId }` | toutes | |

## Messages serveur → client

| Événement | Charge utile |
|---|---|
| `pong` | `{ t, serverTime }` |
| `queue:status` | `{ mode, elapsedMs, searchRange }` |
| `match:found` | `{ matchId, seat: 'left' \| 'right', opponent: { displayName, league, cosmetics }, protocolVersion, rulesVersion, contentVersion, ghost: boolean }` |
| `round:intro` | `{ matchId, round, endsAt, roundsWon, energy, ult }` |
| `recharge:start` | `{ matchId, round, startsAt, endsAt, orbs: OrbSpec[] }` — séquence identique pour les deux joueurs |
| `choice:start` | `{ matchId, round, endsAt, meter: { period, zone, perfect, center }, energy, ult }` — `energy` et `ult` du destinataire uniquement |
| `opponent:locked` | `{ matchId, round }` |
| `intent:shown` | `{ matchId, round, seat, style }` |
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
| `choice:lock` | Phase CHOICE, avant `endsAt + 300 ms` ; coût ≤ énergie ; `ult` seulement si jauge pleine ; cosmétique possédé et compatible avec le mouvement, sinon animation par défaut ; `chargeAt ≥ 0` ; `tapAt − chargeAt ∈ [120, 6000]` ms ; `tapAt` cohérent avec l'heure de réception (écart ≤ RTT mesuré + 250 ms) |
| `intent:show` | Phase CHOICE, avant `choice:lock` du même siège, **une seule annonce par manche et par siège** — sans quoi annoncer les trois styles garantit le bonus de +10 de jauge d'Ultime de `01-game-design.md` §10 |
| Tout message | Schéma zod, joueur bien assis dans ce match, `seq` non déjà traité, limite de débit par socket |

## Délais, déconnexions et reconnexion

- Déconnexion : le match continue. Les échéances s'appliquent et les actions par défaut sont jouées (voir game design §9).
- Reconnexion dans les **45 s** : le client se reconnecte avec le même JWT, envoie `match:rejoin { matchId }`, reçoit `match:state` puis reprend.
- Au-delà de 45 s cumulées, ou deux manches consécutives sans action : forfait.
- Passage de l'app en arrière-plan : le client ferme proprement la socket et se reconnecte au retour (ne pas compter sur la socket survivante).

## Versions

- `PROTOCOL_VERSION` (semver) dans `@aura/protocol`. Major différent ⇒ `error { code: 'CLIENT_OUTDATED' }` et écran de mise à jour.
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
C→S choice:lock      { seq: 9, move:{style:'provoc',tier:2}, amp:1, ult:false, timing:{chargeAt:3100, tapAt:4012} }
S→C round:result     { ... }
S→C round:intro      { round: 2, ... }
```
