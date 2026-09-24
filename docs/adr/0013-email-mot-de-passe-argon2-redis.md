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

**Le mot de passe oublié passe par le code de récupération.** Changer son mot
de passe exige une preuve : l'ancien, **ou** le code. Pas de fenêtre « session
ouverte par code il y a moins de dix minutes » : elle demanderait de marquer
les jetons d'accès, pour un gain nul — le joueur qui vient de se servir de son
code l'a encore sous les yeux.

## Conséquences

- Bloquer une adresse bloque aussi son propriétaire, quinze minutes. Le prix
  est faible : son appareil reste ouvert par son secret, et le code de
  récupération ouvre toujours son compte.
- « Cette adresse est déjà prise » est une information que la route de
  rattachement donne à tout compte invité, donc à tout le monde. Elle est
  bornée comme la connexion.
- Changer d'adresse n'est pas prévu : on change le mot de passe. Un compte
  garde l'adresse qu'il a rattachée.
- Relever les paramètres d'argon2 plus tard ne casse rien : chaque hachage porte
  les siens (format PHC). Re-hacher à la connexion n'est pas encore fait.
- Si un CDN s'intercale un jour devant Traefik, `TRUST_PROXY` doit l'inclure,
  sinon tous ses clients partageront un compteur.
