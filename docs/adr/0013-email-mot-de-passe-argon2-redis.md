# ADR 0013 — Email et mot de passe : argon2id, tentatives comptées dans Redis

- **Statut :** accepté
- **Date :** 2026-09-24

## Contexte

Le joueur veut ouvrir son compte depuis un autre appareil avec un email et un
mot de passe. Le code de récupération (`AuthProvider.RECOVERY`) le permettait
déjà, mais c'est un secret tiré par le serveur, qu'on note ; un mot de passe est
choisi par un humain, donc **devinable**. Trois questions en découlent.

**Comment le stocker ?** Un SHA-256 sans sel suffit pour le secret d'appareil
(256 bits) et le code (80 bits) : aucun dictionnaire ne couvre ces espaces. Un
mot de passe humain, si. Il faut un hachage lent et salé.

**Comment empêcher qu'on les essaie ?** La route de connexion est publique. Sans
limite, elle devient un banc d'essai de listes de mots de passe fuités.

**Et le mot de passe oublié ?** Le serveur n'envoie aucun courrier et n'en
enverra pas : pas de service à exploiter, pas de donnée personnelle de plus.

## Décision

**argon2id, par `@node-rs/argon2`**, aux paramètres OWASP (19 Mio, deux passes,
un fil), écrits dans le code même s'ils sont les défauts — un défaut n'est pas
un contrat. `@node-rs/argon2` plutôt que `argon2` : binaire précompilé par
plateforme, aucun script d'installation, donc rien à trancher dans
`allowBuilds` ni à compiler dans l'image. Le hachage s'exécute hors de la
boucle d'événements.

**Une adresse inconnue coûte le même temps qu'un mauvais mot de passe** : elle
est vérifiée contre un hachage jetable calculé au démarrage, et les deux cas
rendent la même erreur, `INVALID_CREDENTIALS`.

**Les tentatives sont comptées dans Redis**, derrière un port
(`AttemptLimiter`) : 5 par adresse et 20 par IP sur quinze minutes pour la
connexion, 10 rattachements par joueur, 5 changements de mot de passe par
joueur. Redis plutôt que la mémoire du processus : un compteur par instance se
contourne en répartissant les essais, et chaque déploiement le remettrait à
zéro. On compte **les tentatives**, pas les échecs — vérifier puis compter
laisserait passer cent essais lancés ensemble. Le compteur d'adresse porte une
**empreinte** de l'adresse, pas l'adresse. Un double en mémoire passe la même
suite de contrat que l'adaptateur Redis.

**L'adresse IP est celle du joueur, pas celle de Traefik.** `TRUST_PROXY`
désigne les mandataires de confiance *par leur adresse* (`uniquelocal` en
production : Traefik parle depuis le réseau Docker). Fastify 5 refuse
désormais un simple nombre de sauts, et `true` croirait la partie gauche de
`X-Forwarded-For`, que le client écrit.

**Dès qu'une adresse est rattachée, le mot de passe est le secret maître.**
Une session seule (téléphone déverrouillé, jeton volé) ne suffit plus :

- **délivrer un nouveau code de récupération exige l'ancien mot de passe**
  (`POST /auth/recovery { currentPassword }`). Sans cela, l'intrus remplaçait
  le code du joueur par le sien, puis changeait le mot de passe avec ;
- **un code ne prouve un changement de mot de passe que s'il a plus d'une
  heure** (`AuthIdentity.createdAt` de la ligne `RECOVERY`, déjà posé à chaque
  délivrance : aucune migration). Le parcours légitime n'en souffre pas : le
  « mot de passe oublié » se fait avec le code **noté**, délivré bien avant
  (`recovery/claim`, puis changement avec ce même code) ;
- **changer de mot de passe chasse tout le monde** : tous les jetons de
  rafraîchissement sont révoqués et toutes les identités `DEVICE` détachées,
  sauf celle de l'appareil qui fait la demande (il joint son secret). Un
  appareil détaché qui se relance ouvre un compte invité neuf, plus celui-ci.
  Le code de récupération, lui, reste : c'est la porte de secours.

Variante écartée : exiger que la session ait été ouverte par un code depuis
moins de dix minutes. Il faudrait marquer les jetons d'accès, et un code
fraîchement délivré par un intrus passerait quand même.

**Les compteurs d'IP comptent par seau** : une adresse IPv4 vue en IPv6
(`::ffff:a.b.c.d`) est ramenée à l'IPv4, une IPv6 compte par préfixe /64 (un
abonné en reçoit un entier). Une requête sans adresse lisible est refusée
plutôt que rangée sous une clé commune que n'importe qui pourrait remplir.

**Le coût d'argon2 a un plafond global** : deux hachages à la fois, trente-deux
en attente, `503 BUSY` au-delà. Les limites par adresse et par IP ne bornent
pas une rafale répartie sur mille IP et mille adresses ; celui-ci, si. Les
preuves de mot de passe (changement, demande de code) sont aussi comptées par
IP, en plus du joueur.

**Les empreintes d'adresse sont des HMAC** avec la clé du serveur
(`JWT_SECRET`, message préfixé `email-attempts:`), pas un SHA-256 nu qu'on
renverserait en hachant des adresses candidates. Changer `JWT_SECRET` remet
les compteurs d'adresse à zéro, ce qui est sans conséquence.

La longueur minimale est recomptée côté serveur **après NFKC, en caractères** :
c'est ce qui est haché.

## Conséquences

- **Un tiers peut bloquer un compte** quinze minutes en ratant six fois son
  adresse. Le prix est faible : l'appareil du joueur reste ouvert par son
  secret, et le code de récupération ouvre toujours son compte.
- **Un compte sans adresse n'a qu'un facteur : la session.** Qui la détient
  peut rattacher un email, délivrer un code ; c'est la nature d'un compte
  invité, et c'est pour cela que le rattachement d'une adresse est proposé
  dès l'écran de bienvenue.
- **L'adresse n'est pas vérifiée**, donc elle est **réservable** : quelqu'un
  peut rattacher l'adresse d'un autre à son propre compte, et le vrai
  propriétaire lira « adresse déjà utilisée ». Il faudra une procédure de
  support (preuve de possession de la boîte, puis libération de l'adresse) le
  jour où cela arrive ; rien ne l'automatise aujourd'hui.
- « Cette adresse est déjà prise » est une information que la route de
  rattachement donne à tout compte invité, donc à tout le monde. Elle est
  bornée comme la connexion.
- Changer d'adresse n'est pas prévu : on change le mot de passe.
- Relever les paramètres d'argon2 plus tard ne casse rien : chaque hachage porte
  les siens (format PHC). Re-hacher à la connexion n'est pas encore fait.
- **`TRUST_PROXY=uniquelocal` fait confiance à toute adresse privée.** Sur
  `shipease`, le réseau Docker est partagé avec d'autres applications : un
  conteneur voisin compromis pourrait écrire `X-Forwarded-For` et choisir
  l'adresse IP comptée. Le resserrer au sous-réseau de Traefik (un CIDR précis)
  est la prochaine étape. Si un CDN s'intercale un jour devant Traefik, ses
  plages doivent être ajoutées, sinon tous ses clients partageront un compteur.
