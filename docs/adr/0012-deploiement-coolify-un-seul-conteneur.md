# ADR 0012 — Déploiement Coolify : un seul conteneur pour le jeu et son API

- **Statut :** accepté
- **Date :** 2026-09-21

## Contexte

Il faut une version en ligne joignable depuis un téléphone, sans dépendre d'un
Mac allumé sur le Wi-Fi local. Le serveur `shipease` (46.202.154.17) fait déjà
tourner **Coolify 4.3.23** avec Traefik en façade sur 80/443, et une dizaine
d'autres applications : relance-sms, n8n, browserless, locservices. Aura Battle
arrive chez quelqu'un, pas sur une machine vide.

Le client est un build Vite statique ; le serveur est un NestJS sur Fastify qui
porte quelques routes HTTP et, surtout, une passerelle Socket.IO.

## Décision

**Un seul conteneur sert le jeu et son API.** NestJS sert le build du client en
plus de ses routes, par `@fastify/static`, et une 404 de navigation reçoit
`index.html`.

**Pile en `docker-compose.prod.yml`** : `app`, `postgres`, `redis`. Seul `app`
est exposé, par Traefik. Postgres et Redis ne publient **aucun** port sur
l'hôte — sur un serveur partagé, une base qui écoute sur `0.0.0.0` écoute pour
tout le monde.

**Domaine `*.46.202.154.17.sslip.io`**, fourni par Coolify avec son certificat.
Aucun domaine à acheter ; un vrai nom pourra être branché plus tard sans que
l'image change, puisqu'elle ne contient aucune URL.

**Migrations au démarrage du conteneur**, par `prisma migrate deploy`, jamais
`migrate dev` — `dev` peut décider de réinitialiser une base dont l'historique
ne correspond pas.

## Conséquences

**Ce qu'on gagne.** Aucune configuration CORS (`corsOrigins` reste vide, ce que
son commentaire supposait déjà). Aucune URL de serveur figée dans le build : le
client parle à l'origine qui l'a servi, donc la même image tourne derrière
n'importe quel domaine. Un seul objet à déployer, à surveiller et à redémarrer.

**Ce qu'on paie.** Le client et le serveur se déploient ensemble : corriger une
faute de frappe dans un libellé reconstruit et redémarre le serveur de match,
donc coupe les parties en cours. Acceptable tant qu'un seul nœud tourne ; ça ne
le sera plus quand le multi-nœuds de M7 arrivera, où un client servi par un CDN
séparé redevient le bon découpage.

**Un seul nœud.** L'adaptateur Redis de Socket.IO n'est pas câblé : deux
répliques ne se verraient pas. Le banc de charge dit d'où ça devient nécessaire
— à 1000 matchs, 68 % d'un cœur (ADR 0011). En dessous, une seule réplique tient
largement, et Traefik n'a aucune session collante à gérer.

**L'image pèse 629 Mo**, dont environ 230 pour Prisma seul : le client généré,
le CLI, les moteurs, et — embarqués par le paquet `prisma` — Studio et pglite,
qui ne servent jamais en production. Les élaguer à la main gagnerait 85 Mo au
risque de casser `migrate deploy` un jour de déploiement : mauvais échange.

## Pièges rencontrés en y arrivant

Chacun a coûté une construction, et aucun n'était deviné d'avance.

- **pnpm 11 refuse de purger `node_modules` sans terminal.** `CI=true` dans
  l'image, sinon l'étape s'arrête sur une question que personne ne peut lire.
- **Une installation `--prod` par-dessus une installation complète ne réduit
  rien.** pnpm défait les liens, mais les paquets restent dans
  `node_modules/.pnpm`, qui appartient déjà à la couche précédente. Il faut
  repartir d'une base propre : 796 Mo → 629 Mo.
- **`prisma generate` exige `DATABASE_URL`** alors qu'il ne touche aucune base :
  `prisma.config.ts` évalue `env()` à l'import (ADR 0007). L'URL est donnée pour
  cette seule commande, jamais en `ENV` — une URL de construction restée dans
  l'image serait une valeur par défaut crédible et fausse.
- **Le client Prisma est généré au fond du magasin pnpm**, dans un chemin qui
  contient le hachage des dépendances. On le régénère sur l'arbre de production
  plutôt que de coder ce hachage en dur.
- **Nest pose son propre gestionnaire de 404** pendant `init()`. Un second
  `setNotFoundHandler` fait échouer Fastify au démarrage — donc *après* un
  déploiement réussi. Le repli passe par un filtre d'exception Nest.
- **Le client avait une adresse de serveur en dur.** `resolveServerUrl`
  retombait sur `http://<hôte>:3000`, juste en développement et faux derrière un
  proxy HTTPS : le jeu s'arrêtait sur « connexion impossible » alors que le
  serveur répondait parfaitement, à un port près. Le repli est maintenant
  l'origine de la page, et c'est le développement qui est le cas particulier.

## Alternatives écartées

**Deux applications Coolify**, client et serveur séparés. Deux domaines, du
CORS à déclarer, et l'adresse de l'API figée à la compilation du client — trois
problèmes créés pour un découpage dont on n'a pas encore besoin.

**Déployer sans Coolify**, en `docker compose` à la main. Le serveur héberge
déjà d'autres applications derrière Traefik ; s'installer à côté du gestionnaire
plutôt que dedans aurait demandé de dupliquer sa configuration de proxy et ses
certificats.
