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
- JWT d'accès courts (15 min) + refresh token avec rotation.
- Aucune donnée sensible dans les messages temps réel.
- Journal des événements de chaque match conservé 30 jours pour les litiges.

## Intégrité du client (plus tard)

- Play Integrity (Android) et App Attest (iOS) sur l'authentification, pour réduire les clients modifiés en classé.
- Mode classé réservé aux versions signées ; partie rapide et invitation ouvertes.
