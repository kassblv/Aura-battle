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
- **Écritures d'inventaire bornées par joueur** (`InventoryRateLimit`) : seau à jetons en mémoire, un par joueur et par route. `PUT /inventory/loadout` : rafale 12, puis 2 par seconde — le vestiaire équipe au toucher, et quatre touches par seconde tiennent près de six secondes sans attente. `POST /inventory/buy` : rafale 5, puis 1 par seconde. Le jeton est pris après l'authentification et **avant** l'analyse du corps : un corps invalide ou un achat refusé coûte autant qu'un autre. Refus en 429 `RATE_LIMITED`, traduit par le client (« Doucement ! Réessaie dans un instant. »). Chaque écriture ne lit l'inventaire qu'une fois et le catalogue reste en mémoire (il ne change qu'au seed, joué avant le démarrage) : un équipement coûte quatre requêtes SQL. **Réserves :** la limite vit dans le processus (un seul conteneur, ADR 0012 ; à porter dans Redis au multi-nœud) ; comptée par joueur, elle ne borne pas un attaquant aux nombreux comptes invités, que seule la limite par IP de `/auth/device` freine ; `GET /inventory` (trois requêtes) n'est pas limité.
- **Connexion par email : tentatives bornées** (ADR 0013). 5 par adresse et 20 par IP sur quinze minutes, comptées dans Redis **avant** le hachage — une rafale bloquée ne coûte rien au processeur. Une réponse unique, `INVALID_CREDENTIALS`, et le même temps de calcul pour une adresse inconnue que pour un mauvais mot de passe. L'IP est celle du joueur grâce à `TRUST_PROXY`, jamais la partie de `X-Forwarded-For` que le client écrit. Les échecs sont journalisés avec un fragment d'empreinte de l'adresse, jamais l'adresse ni le mot de passe.
- **Une session seule ne prend pas un compte** (ADR 0013) : délivrer un code de récupération exige le mot de passe (ou, sans adresse, le secret d'un appareil du joueur, comme pour rattacher une adresse) ; aucun appareil ne se rattache sans preuve — `recovery/claim` et `email/login` rattachent le secret neuf dans la même requête, il n'y a plus de route autonome, et un joueur garde au plus dix appareils ; un code ne prouve un changement de mot de passe que s'il a plus d'une heure. Changer de mot de passe révoque toutes les sessions, détache tous les appareils sauf le sien, ferme ses sockets et **incrémente la version des identifiants** (`Player.credentialsVersion`, claim `cv` exigé égal sur chaque route et au handshake). Le renouvellement consomme son jeton atomiquement et lit la version sous verrou. Seuls les échecs de preuve comptent par joueur, et par appareil : un intrus ne bloque pas le propriétaire.
- **Limite de débit par IP des routes publiques d'authentification** : `/auth/device` et `/auth/refresh` 60, `/auth/recovery/claim` 20 par quart d'heure et par seau d'IP ; désactivable hors production seulement. Connexions par email : 30 par IP et par quart d'heure, réussies comprises.
- **Une preuve ne vaut que pour la version des identifiants lue avec elle** : le rattachement d'appareil et l'émission du jeton exigent encore cette version sous verrou ; un changement de mot de passe remplace aussi le code de récupération (le neuf est affiché au joueur).
- **Réserves connues** (ADR 0013) : session volée sur un compte invité valable jusqu'à 30 jours faute de « fermer les autres sessions » ; fermeture des sockets et évènement de changement limités au nœud courant (Redis au multi-nœud) ; création de comptes invités bornée seulement par IP (/48, plafond global et purge des jetons expirés à prévoir) ; CGNAT au-delà de soixante joueurs par IPv4.
- **Limites connues** (ADR 0013) : six essais ratés bloquent une adresse quinze minutes, y compris pour son propriétaire (le code de récupération reste ouvert) ; une adresse non vérifiée est réservable par un tiers, procédure de support à prévoir ; `TRUST_PROXY=uniquelocal` croit tout le réseau Docker partagé de `shipease`, à resserrer au sous-réseau de Traefik.
- JWT d'accès courts (15 min) + refresh token avec rotation.
- Aucune donnée sensible dans les messages temps réel.
- Journal des événements de chaque match conservé 30 jours pour les litiges.

## Intégrité du client (plus tard)

- Play Integrity (Android) et App Attest (iOS) sur l'authentification, pour réduire les clients modifiés en classé.
- Mode classé réservé aux versions signées ; partie rapide et invitation ouvertes.
