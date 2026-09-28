# ADR 0011 — Banc de charge : mesure en processus, exposée sur une route optionnelle

- Statut : accepté
- Date : 2026-09-20

## Contexte

`docs/08` § M7 pose un critère chiffré : **500 matchs simultanés sur un nœud, p95 de
traitement d'un message entrant sous 20 ms**. C'est le seul critère de la feuille de route
qui puisse *invalider* une décision d'architecture plutôt qu'ajouter une fonctionnalité, et
il doit se rejouer à chaque jalon pour que deux relevés se comparent.

Trois façons de le mesurer étaient possibles, et deux répondent à côté.

**Depuis un client** (k6, Artillery). On mesure alors un aller-retour, c'est-à-dire le
réseau, la pile TCP, l'ordonnancement du poste de mesure **et** le serveur, sans moyen de
les séparer. Le relevé obtenu ici le montre : à 500 matchs, les processus clients du banc
voient 100 ms d'aller-retour médian là où le serveur passe 0,13 ms à traiter le message.
Une p95 lue depuis le client aurait déclaré le critère manqué alors qu'il est tenu avec un
facteur 40 de marge.

**Par une trace** (`--cpu-prof`, `perf`). Volumineuse, impossible à comparer d'un jalon à
l'autre, et elle perturbe ce qu'elle observe.

**Depuis le serveur lui-même**, en agrégeant. C'est ce qui répond à la question posée.

Restait à décider où cette instrumentation vit et ce qu'elle coûte quand personne ne mesure.

## Décision

**Un collecteur en processus, `shared/metrics.ts`, éteint par défaut.** Sans
`AURA_METRICS=1`, chacun de ses points d'appel se réduit à un test de booléen ; aucune file,
aucun histogramme, aucun observateur de ramasse-miettes n'existe. Un serveur de production
non instrumenté ne paie rien.

**On agrège, on n'enregistre pas.** Les durées vont dans des histogrammes à mémoire fixe
(paliers de 5 µs sous la milliseconde, de 50 µs jusqu'à 20 ms, de 500 µs jusqu'à 200 ms, de
25 ms jusqu'à 5 s). `record` n'alloue rien : garder des centaines de milliers de durées une
par une ferait travailler le ramasse-miettes, c'est-à-dire perturberait exactement ce qu'on
mesure. Les percentiles sont rendus par la **borne haute** du palier : l'erreur joue
toujours dans le sens sévère, on ne déclare jamais un seuil tenu à tort.

**La fenêtre mesurée va du décodage du paquet à la fin du gestionnaire.** Elle s'ouvre dans
`socket.onAny` — donc avant la limite de débit et avant la validation de schéma, qui font
partie du traitement — et se ferme dans un intercepteur NestJS global. L'appariement des
deux bouts se fait **par nom d'événement** et non par ordre d'arrivée : `queue:join` attend
Redis pendant que le `ping` suivant a déjà répondu, et un message valide sans gestionnaire
(`intent:show`) ne doit pas décaler tout ce qui le suit.

**Le relevé sort par `GET /health/metrics`**, remis à zéro par `POST /health/metrics/reset`.
Éteinte, la route répond `{ enabled: false }` plutôt que des zéros : un banc lancé contre un
serveur non instrumenté doit s'en apercevoir, pas conclure à zéro message traité. Ce qui
sort est agrégé et anonyme — des comptes, des percentiles, un nombre de matchs vivants. Rien
qui puisse renseigner un adversaire (règle d'or n°4).

**Chaque relevé porte ses témoins de fiabilité**, et ils ne sont pas décoratifs :

- le **retard de la boucle d'événements**, période d'échantillonnage déduite ;
- les **pauses du ramasse-miettes**, comptées séparément — un retard expliqué par le
  ramasse-miettes se soigne en allouant moins, un retard de travail synchrone se soigne en le
  découpant, et sans ce partage on optimise au hasard ;
- les **compteurs vivants** (matchs, minuteurs, sessions) : un banc qui annonce 500 matchs
  doit pouvoir le vérifier côté serveur, sinon il mesure un serveur à moitié vide ;
- les **tâches de fond** (`match:save`, `outbound:validate`, `outbound:emit`) : ce qui coûte
  du temps **sans** appartenir à la fenêtre d'un message. L'écriture d'un match achevé en est
  l'exemple — elle ne retarde aucun joueur, donc aucun percentile de message ne la voit, et
  c'est pourtant la première chose qui cède en montant en charge.

**Le banc vit hors de la suite de tests** (`apps/server/bench/`, `pnpm --filter server
bench`). Personne ne veut mille connexions à chaque `pnpm test`. Il lance **son propre
serveur**, sur son propre port et sa propre base Redis, et répartit ses clients dans des
processus séparés.

**Un client témoin, seul dans le processus de l'orchestrateur, ping toutes les 200 ms.**
C'est lui qui tranche la question que le relevé serveur ne peut pas trancher : quand les
processus clients du banc mesurent 100 ms d'aller-retour et que le serveur annonce 0,13 ms
de traitement, où sont passées les 99 autres ? Le témoin répond en 1 ms — elles sont dans le
banc.

## Conséquences

- `MessageMetrics` est injecté dans la passerelle, le registre de sessions et le dépôt de
  matchs. Trois dépendances de plus, toutes vers un service partagé et sans effet quand il
  est éteint.
- L'intercepteur global est enregistré **toujours**, allumé ou non : un enregistrement
  conditionnel ferait que le chemin mesuré ne soit pas tout à fait celui qui tourne en
  production. Éteint, il rend `next.handle()` sans y ajouter le moindre opérateur.
- La correspondance « arrivée / fin de traitement » dépend de deux détails de bibliothèque —
  `socket.onAny` se déclenche avant les intergiciels de Socket.IO, `WsProxy` transmet le nom
  de l'événement à `getPattern()`. Ils sont **vérifiés par un test de bout en bout**
  (`metrics-e2e.test.ts`) avec un gestionnaire volontairement lent, et non supposés.
- La taille du bassin de connexions Postgres devient explicite (`DATABASE_POOL_MAX`, 20) au
  lieu d'hériter du défaut du pilote. Voir `docs/09` pour ce que la mesure en dit.
- Le banc écrit dans la base de développement et crée des comptes invités déterministes
  (`bench_0`… `bench_N`) : deux relevés portent donc sur la même population.
