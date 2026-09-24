# 06 — Anti-triche

## Ce qui est structurellement protégé

- **Scores, contres, énergie, Ultime, vainqueur :** calculés uniquement par le serveur.
- **Choix adverse :** jamais transmis avant `round:result`.
- **Cosmétiques :** vérifiés contre l'inventaire serveur.

## Ce qui ne peut pas être totalement protégé

Le client doit afficher la jauge de timing et les orbes, donc un client modifié connaît leurs paramètres et peut taper « parfaitement ». On ne peut pas l'empêcher, seulement **limiter l'impact** et **détecter**.

### Limiter l'impact

- Plafonds de gains déjà dans les règles : boost de recharge à 25 %, énergie de recharge à +2, parfait à ×1,5.
- Taux de tap plafonné à 12/s, taps hors orbe vivante ignorés.
- Délai minimal humain : `tapAt − chargeAt ≥ 120 ms`.
- Contrôle de cohérence temporelle : un tap annoncé à `t` doit arriver au serveur dans une fenêtre compatible avec le RTT mesuré.
- Variation de la période de la jauge par manche (graine), pour empêcher un « réflexe mémorisé ».

### Détecter (jalon M7)

Scores calculés en tâche de fond et stockés dans `SuspicionFlag` :

| Signal | Indice |
|---|---|
| Taux de parfaits | > 70 % sur 30 manches alors que la médiane de la ligue est bien plus basse |
| Distribution des écarts de timing | Écart-type anormalement faible (précision non humaine) |
| Recharge | Points proches du maximum théorique de façon répétée, intervalles entre taps trop réguliers |
| Latence | Taps dont l'instant annoncé contredit systématiquement l'heure de réception |
| Comportement | Abandons ciblés pour manipuler le classement, comptes multiples sur un même appareil |

Sanctions progressives : partie rapide uniquement, puis suspension, puis bannissement. Revue humaine avant le bannissement.

## Réseau et abus

- Limite de débit par socket et par IP (messages/seconde, créations d'invitations/minute).
- **Connexion par email : tentatives bornées** (ADR 0013). 5 par adresse et 20 par IP sur quinze minutes, comptées dans Redis **avant** le hachage — une rafale bloquée ne coûte rien au processeur. Une réponse unique, `INVALID_CREDENTIALS`, et le même temps de calcul pour une adresse inconnue que pour un mauvais mot de passe. L'IP est celle du joueur grâce à `TRUST_PROXY`, jamais la partie de `X-Forwarded-For` que le client écrit. Les échecs sont journalisés avec un fragment d'empreinte de l'adresse, jamais l'adresse ni le mot de passe.
- **Une session seule ne prend pas un compte** (ADR 0013) : délivrer un code de récupération exige le mot de passe (ou, sans adresse, le secret d'un appareil du joueur, comme pour rattacher une adresse), un code ne prouve un changement de mot de passe que s'il a plus d'une heure, et changer de mot de passe révoque toutes les sessions, détache tous les appareils sauf le sien et **invalide tout jeton d'accès antérieur** (`Player.credentialsChangedAt`, vérifié sur chaque route et au handshake Socket.IO). Le renouvellement consomme son jeton atomiquement et ne peut pas devancer une révocation. Seuls les échecs de preuve comptent par joueur, et par appareil : un intrus ne bloque pas le propriétaire. Plafond global de deux hachages argon2 simultanés (`503 BUSY` au-delà). Compteurs d'IP par seau (IPv6 par /64), requête sans adresse refusée.
- **Limites connues** (ADR 0013) : six essais ratés bloquent une adresse quinze minutes, y compris pour son propriétaire (le code de récupération reste ouvert) ; une adresse non vérifiée est réservable par un tiers, procédure de support à prévoir ; `TRUST_PROXY=uniquelocal` croit tout le réseau Docker partagé de `shipease`, à resserrer au sous-réseau de Traefik.
- JWT d'accès courts (15 min) + refresh token avec rotation.
- Aucune donnée sensible dans les messages temps réel.
- Journal des événements de chaque match conservé 30 jours pour les litiges.

## Intégrité du client (plus tard)

- Play Integrity (Android) et App Attest (iOS) sur l'authentification, pour réduire les clients modifiés en classé.
- Mode classé réservé aux versions signées ; partie rapide et invitation ouvertes.
