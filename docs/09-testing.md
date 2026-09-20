# 09 — Tests et équilibrage

## Pyramide

| Niveau | Outil | Cible |
|---|---|---|
| Unitaire | Vitest | `@aura/rules` (≥ 95 % lignes), `@aura/protocol`, services du serveur |
| Propriétés | fast-check | Invariants des règles (déterminisme, bornes, fin de match) |
| Contrat | Vitest + zod | Chaque message émis par le serveur passe son schéma |
| Intégration | Testcontainers | Repositories Prisma, file Redis |
| E2E temps réel | Serveur réel + 2 clients Socket.IO | Scénarios de match complets |
| Rendu | Vitest + snapshot numérique | `AnimationPlayer` : positions d'articulations à des instants donnés |
| Charge | Banc maison (`apps/server/bench`) | Matchs simultanés, temps de traitement d'un message |
| Manuel | Checklist | Ressenti, lisibilité, sons, haptique |

## Invariants à tester en propriétés

- Même graine + même suite d'événements ⇒ même état final (octet pour octet).
- L'énergie reste dans [0, 14] ; la jauge d'Ultime dans [0, 100].
- Un choix dont le coût dépasse l'énergie est refusé sans modifier l'état.
- Tout match se termine en 3 manches maximum, avec au plus un vainqueur.
- Un message `round:result` n'est émis qu'après verrouillage des deux joueurs ou échéance.
- Aucun message envoyé à un siège avant `round:result` ne contient le choix de l'autre siège.

## Scénarios e2e obligatoires

1. Match complet 2–0 et 2–1.
2. Un joueur ne verrouille pas : action par défaut, pas de blocage.
3. Déconnexion pendant la recharge, reconnexion pendant le choix.
4. Déconnexion définitive : forfait après 45 s.
5. Choix trop cher, Ultime non prête, double verrouillage : erreurs attendues.
6. Taps impossibles (orbe morte, 30 taps/s) : ignorés et signalés.
7. Client d'une version majeure différente : `CLIENT_OUTDATED`.

## Test manuel : un duel à deux navigateurs

Automatisable en partie, mais pas entièrement : ce qui se vérifie ici est ce
qu'aucun test ne voit — le cadrage, la lisibilité, le ressenti. À rejouer avant
chaque livraison.

**Le piège qui fait perdre le plus de temps :** deux onglets du même navigateur
sur la même origine partagent `localStorage`, donc le **même secret d'appareil**,
donc le **même joueur**. On ne peut pas rejoindre sa propre invitation, et le
symptôme (« le code ne marche pas ») n'a rien à voir avec la cause. Il faut donc
deux **origines** distinctes, pas deux onglets.

```bash
docker compose up -d                    # Postgres sur 5433, Redis sur 6379
pnpm dev                                # serveur :3000, client :5173
pnpm --filter mobile exec vite --port 5174 --host   # seconde origine
```

Ouvrir `http://localhost:5173` et `http://192.168.64.1:5174` (l'adresse de la
seconde origine dépend de la machine : `ipconfig getifaddr en0` sur macOS).
Redimensionner les deux à **844×390** — le format cible, en paysage.

| # | Geste | Ce qu'on vérifie |
|---|---|---|
| 1 | Choisir un nom différent sur chaque origine | Le renommage passe par le serveur et survit au rechargement |
| 2 | « Duel » puis « Créer une partie » sur A | Un code à 6 caractères s'affiche |
| 3 | Entrer ce code sur B | Les DEUX entrent en match |
| 4 | Lire le bandeau des deux côtés | Chacun voit le nom de l'**adversaire**, pas le sien, pas « Adversaire » |
| 5 | Regarder l'arène | **Deux** combattants, face à face, animés |
| 6 | Jouer une manche complète | La jauge est lisible, la danse se joue avant le verdict |
| 7 | Couper le réseau de B pendant la recharge, le rétablir | B reprend la manche en cours, sans information cachée |

**Ce qui a déjà été pris ici, et que les tests ne voyaient pas :** le nom de
l'adversaire codé en dur côté serveur ; un seul combattant affiché en ligne ;
la jauge qui peignait ses zones à une position différente de celle que le moteur
jugeait. Aucun de ces trois défauts n'a fait échouer un test.

## Budget d'images, et comment il se mesure

M6 vise **60 i/s**, avec **30 i/s** comme plancher sur un appareil milieu de
gamme. On l'approche en ralentissant le processeur d'un facteur **4** dans
Chrome, fenêtre à 844×390 — le format cible.

La mesure ne passe pas par une trace : elle est trop volumineuse à exporter, et
ce qu'on veut tient en trois nombres. On compte les écarts entre images sur
plusieurs secondes et on lit :

- la **moyenne**, qui dit le confort général ;
- la **médiane**, qui dit si le problème est de fond ou par à-coups ;
- le **nombre d'images au-dessus de 33 ms**, c'est-à-dire sous le plancher.

C'est cet écart moyenne/médiane qui a désigné le coupable : une médiane à 58,5
avec une moyenne à 42 ne décrit pas un moteur lent, elle décrit une pile qui
cale régulièrement.

**La fenêtre de mesure doit contenir le pire moment de l'écran**, sinon elle
mesure autre chose. Pour le match, ce moment est la phase de choix **jauge
armée** : aiguille en mouvement, trente boutons, deux grappes et la jauge à
l'écran en même temps. Une fenêtre qui s'arrête à la recharge donne 55 i/s et
zéro image lente — et ne voit rien. Les relevés ci-dessous couvrent une manche
entière : recharge, choix jauge armée, verrouillage, révélation.

Relevés au 20 septembre 2026, ralenti ×4 :

| Écran | Moyenne | Médiane | Images > 33 ms |
|---|---|---|---|
| Accueil, avant | 42,1 i/s | — | 28 sur 209 (13 %) |
| Accueil, après | **60,0 i/s** | — | **0** |
| Match, avant | 36,8 i/s | 42,4 i/s | 252 sur 515 (49 %) |
| — dont phase de choix, jauge armée | 27,6 i/s | 28,2 i/s | 252 sur 254 (99 %) |
| Match, après | **59,9 i/s** | 59,9 i/s | **0 sur 1 318** |

L'accueil rendait tout l'arbre React soixante fois par seconde alors que rien
de ce qu'il affiche ne dépend du temps ; l'arène, elle, lit ses références dans
sa propre boucle et n'a jamais eu besoin de React. L'écran de match faisait
pire : il redessinait trente boutons pour déplacer une aiguille. Il sépare
désormais les deux rythmes — `ui/renderKey.ts` dit ce que React doit redessiner,
`ui/frame.ts` calcule ce que la boucle d'animation écrit directement sur des
références. Pendant trois secondes de jauge en mouvement, les deux grappes de
boutons n'enregistrent **aucune** mutation du DOM.

Le « après » du match est reproductible : cinq mesures consécutives, zéro image
au-dessus de 33 ms à chaque fois.

**Une machine chargée invalide la mesure, et ça ne se voit pas dans la
moyenne.** Sur ce poste à `load average` 12, le même code a donné entre 0 et 55
images lentes selon le moment, avec des images isolées à 200 ms qui ne
viennent pas de la page. Le signe qui ne trompe pas est le **nombre d'images
capturées** : 22 secondes de fenêtre doivent en rendre environ 1 320. Nettement
moins, et c'est la machine qu'on mesure, pas le client.

## Banc de charge : 500 matchs sur un nœud

Le critère M7 est chiffré : **500 matchs simultanés, p95 de traitement d'un message entrant
sous 20 ms**. Il se rejoue à volonté, hors de la suite de tests — personne ne veut mille
connexions à chaque `pnpm test`.

```bash
docker compose up -d                                   # Postgres 5433, Redis 6379
pnpm --filter server bench                             # 500 matchs, 60 s de mesure
pnpm --filter server bench -- --matches 1000 --workers 8 --out 1000.json
```

Le banc lance **son propre serveur** (port 3999, base Redis 9, `NODE_ENV=production`,
`AURA_METRICS=1`) et répartit ses joueurs dans des processus séparés. Options utiles :
`--matches`, `--workers`, `--port`, `--redis-db`, `--db-pool`, `--ramp-ms`, `--settle-ms`,
`--measure-ms`, `--pairing invite|queue`, `--out fichier.json`, `--attach` (mesurer un
serveur déjà lancé).

### Ce qu'on mesure, et où la fenêtre commence

La fenêtre va du **décodage du paquet** à la **fin du gestionnaire** : la limite de débit et
la validation de schéma en font partie, parce qu'un message refusé coûte lui aussi du temps
serveur. Elle est ouverte par `socket.onAny` et fermée par un intercepteur NestJS
(ADR 0011) ; `metrics-e2e.test.ts` le vérifie sur la vraie pile avec un gestionnaire
volontairement lent, plutôt que de le supposer.

Ce que la fenêtre ne contient **pas** est tout aussi important : l'écriture du match achevé
et le classement partent après que les deux joueurs ont reçu leur résultat. Ils n'apparaissent
dans aucun percentile de message — et ce sont eux qui cèdent en premier. Ils ont donc leur
propre chronomètre (`match:save`, `outbound:validate`, `outbound:emit`).

### Comment on sait qu'on mesure le serveur

Cinq témoins accompagnent chaque relevé, et aucun n'est décoratif.

| Témoin | Ce qu'il dit quand il dérape |
|---|---|
| Matchs vivants / demandés | Le serveur est à moitié vide : on mesure autre chose |
| Retard de la boucle d'événements | Le nœud cale ; les percentiles de message ne le montrent pas |
| Pauses du ramasse-miettes | Un retard de boucle expliqué par le GC ne se soigne pas comme un retard de travail synchrone |
| Messages envoyés par les clients / reçus par le serveur | Un écart dit que la charge offerte n'est pas celle qu'on croit |
| Aller-retour du **témoin** (un client seul dans un processus inoccupé) | La latence relevée par les processus clients parle du banc, pas du serveur |

Le dernier a changé la lecture du premier relevé. À 500 matchs, les processus clients du
banc mesuraient **100 ms d'aller-retour médian** ; le témoin, seul, répondait en **1 ms**.
Les 99 autres étaient dans les processus clients, qui tiennent 250 sockets chacun. Une
mesure prise depuis un client de charge aurait déclaré le critère manqué alors qu'il est
tenu avec un facteur 40 de marge.

### Relevés du 20 septembre 2026

MacBook 12 cœurs, 16 Gio, Postgres et Redis en conteneur, **machine partagée avec d'autres
travaux** (`load average` 14 à 18 pendant les mesures). Fenêtre de 60 s en régime établi,
après une montée en charge étalée et 10 s de stabilisation. Les clients tapent 6 fois par
seconde par lots de 500 ms et verrouillent à mi-phase de choix.

Temps de traitement d'un message entrant, côté serveur :

| Matchs | Messages/s | Médiane | p95 | p99 | p999 | Max | Charge machine | Verdict M7 |
|---|---|---|---|---|---|---|---|---|
| 100 | 162 | 0,160 ms | 0,470 ms | 0,870 ms | 2,50 ms | 10,5 ms | 34 | tenu |
| 250 | 398 | 0,130 ms | 0,440 ms | 0,855 ms | 4,45 ms | 26,1 ms | 34 | tenu |
| 500 | 810 | 0,130 ms | 0,435 ms | 0,980 ms | 5,35 ms | 83,9 ms | 14 | tenu |
| 1000 | 1616 | 0,125 ms | 0,435 ms | 1,10 ms | 6,95 ms | 78,4 ms | 16 | tenu |
| **500, configuration livrée** | **809** | **0,135 ms** | **0,500 ms** | **1,30 ms** | **12,9 ms** | **114 ms** | **19 → 33** | **tenu** |

La dernière ligne est la **référence du jalon** : bassin de connexions à 20, c'est-à-dire ce
qui tourne. Sa queue est plus épaisse que celle des autres parce que la charge de la machine
a doublé **pendant** la fenêtre — le témoin le dit (maximum d'aller-retour à 1398 ms, retard
de boucle à 1089 ms), et c'est précisément à cela qu'il sert.

**La p95 ne bouge pas entre 100 et 1000 matchs.** Ce n'est pas le message qui coûte : c'est
leur nombre. Par type, à 500 matchs, `recharge:taps` tient en 0,115 ms de médiane,
`choice:lock` — qui résout la manche, sérialise deux `round:result` et parfois termine le
match — en 0,37 ms. Le filtre d'entrée seul (débit + schéma) coûte 0,015 ms de médiane :
la validation zod n'est pas un problème.

### Ce qui casse en premier, et pourquoi

Pas le critère. À 500 matchs le nœud consomme **37 % d'un cœur** ; à 1000, **68 %**. Ce qui
se dégrade entre les deux est tout ce qui **n'appartient à la fenêtre d'aucun message** :

| | 500 matchs | 1000 matchs |
|---|---|---|
| p95 de traitement d'un message | 0,435 ms | 0,435 ms |
| Retard de boucle, p99 | 11,5 ms | 40,7 ms |
| Retard de boucle, max | 426 ms | 822 ms |
| Aller-retour du témoin, médiane | 1 ms | 2 ms |
| **Aller-retour du témoin, p95** | **55 ms** | **317 ms** |
| Écriture d'un match, médiane | — | 54,5 ms |
| **Écriture d'un match, p99** | — | **975 ms** |
| Mémoire résidente | 704 Mio | 945 Mio |

Et lors du premier passage à 1000 matchs, des écritures ont **échoué** — `P2028:
Unable to start a transaction in the given time`. Des matchs disparaissent, sans qu'aucune
latence ne bouge d'un dixième de milliseconde. C'est exactement le genre de panne qu'un
relevé de messages ne voit pas, et la raison pour laquelle les tâches de fond ont leur
propre compteur.

**Pourquoi.** Le budget de la boucle, à 1000 matchs sur une fenêtre de 60 s (40,8 s de
processeur consommées) :

| Poste | Temps | Part du processeur |
|---|---|---|
| Traitement des messages entrants (96 939 × 0,191 ms) | 18,5 s | 45 % |
| Ramasse-miettes (573 pauses, 3 majeures) | 3,3 s | 8 % |
| Validation des messages sortants (33 325 × 0,1 ms) | 3,3 s | 8 % |
| Émission des messages sortants (33 325 × 0,1 ms) | 3,3 s | 8 % |
| **Non attribué** : décodage et encodage Socket.IO, protocole pg, entrées-sorties | **12,4 s** | **31 %** |

Deux enseignements. Le premier : **notre code n'est pas le principal consommateur** — près
d'un tiers du processeur part dans le cadrage Socket.IO et la (dé)sérialisation JSON, en
dehors de tout ce que nous avons écrit. Le second : à 68 % d'occupation d'un fil d'exécution
unique, avec des arrivées **en rafales** — les transitions de phase touchent des centaines de
matchs à la même milliseconde —, la file d'attente de la boucle explose par intermittence.
C'est ce qui produit une médiane parfaitement saine sous une queue épaisse, et c'est la
signature d'une pile qui cale, pas d'une lenteur de fond.

L'écriture d'un match en est la victime, pas la cause : quatre allers-retours Postgres dans
une transaction interactive, dont chaque reprise attend la boucle. 55 ms de médiane pour
quatre requêtes locales qui devraient en coûter quatre.

### Ce que la mesure a corrigé

**Bassin de connexions Postgres.** Le pilote `pg` en ouvre dix par défaut — un défaut de
bibliothèque, pas une décision, et le même pour un script d'administration que pour un nœud
qui tient mille duels. Il est désormais explicite : `DATABASE_POOL_MAX`, 20 par défaut.

Mesure avant/après, 1000 matchs, deux passages chacun, **dans cet ordre** — les passages
à 20 ont donc tourné avec une base plus grosse, c'est-à-dire dans des conditions moins
favorables :

| | Bassin 10 | Bassin 10 | **Bassin 20** | **Bassin 20** |
|---|---|---|---|---|
| Écriture d'un match, médiane | 160 ms | 192 ms | **44 ms** | **81 ms** |
| Écriture d'un match, moyenne | 295 ms | 287 ms | **156 ms** | **230 ms** |
| Écriture d'un match, p95 | 875 ms | 925 ms | **600 ms** | **850 ms** |
| p999 de traitement d'un message | 25,0 ms | 8,95 ms | **6,0 ms** | **7,5 ms** |
| Retard de boucle, p99 | 110 ms | 87 ms | **55 ms** | **74 ms** |
| Retard de boucle, max | 3784 ms | 1235 ms | **759 ms** | **1106 ms** |
| **Aller-retour du témoin, médiane** | **14 ms** | **11 ms** | **3 ms** | **4 ms** |
| Aller-retour du témoin, p95 | 739 ms | 462 ms | **276 ms** | **410 ms** |
| Processeur | 65 % | 70 % | 68 % | 69 % |

Toutes les grandeurs s'améliorent, à consommation de processeur identique : le nœud
n'attendait pas moins, il attendait **moins souvent une connexion libre**. Ce que le joueur
ressent — la médiane du témoin — passe de 11-14 ms à 3-4 ms.

**Ce n'est pas une optimisation du chemin critique**, et la p95 de traitement d'un message
ne bouge pas (elle n'avait pas de raison de bouger). C'est la disparition d'une panne
silencieuse : à mille matchs, avec dix connexions, des écritures expirent et des matchs
disparaissent sans qu'aucune latence ne le signale.

**Un avertissement sur la méthode.** Deux passages du banc ne sont pas indépendants : ils
écrivent dans la même base, qui grossit de mille matchs à chaque fois. Les premiers relevés
de la journée voyaient une écriture à 39 ms de médiane là où les derniers en voient 160 avec
le même code. Pour comparer deux versions du serveur, il faut donc **alterner** les passages
ou repartir d'une base vide (`--database-url` vers une base dédiée reste à faire).

### Ce que le banc a appris sur lui-même

Un banc de charge est un programme comme un autre, et le sien s'est bloqué à 940 connexions
sur 1000, serveur à 3 % de processeur, sans le moindre message d'erreur. La cause : les
sockets se connectaient **dès leur construction**, donc leur `connect_error` était émis bien
avant que quiconque n'écoute — mille sockets créées d'un coup, puis attendues seize par
seize. Le banc attendait indéfiniment un événement déjà passé. `autoConnect: false` rend du
même coup `--connect-concurrency` effectif : la cadence d'ouverture est commandée au lieu
d'être subie.

À retenir pour toute mesure temps réel de ce dépôt : **on écoute d'abord, on compose
ensuite** — c'est le même piège que l'`onAny` posé trop tard dans les tests e2e.

### Ce qu'il reste à mesurer

- **Sur une machine au repos.** Tous les relevés ci-dessus ont été pris à `load average` 14
  à 18. Les médianes y sont peu sensibles, les maxima beaucoup.
- **Le chemin `--pairing queue`.** Les relevés portent sur des matchs d'invitation.
  L'appariement est en O(n²) par tour (`pairTickets`) et n'a pas encore été mesuré à mille
  tickets en file.
- **La reprise après redémarrage d'un nœud** et **le multi-nœuds**, deuxième moitié de M7 :
  c'est la réponse à la saturation d'une boucle unique, et la mesure ci-dessus dit à partir
  d'où elle devient nécessaire.

## Équilibrage par simulation

`pnpm sim` fait jouer des stratégies entre elles et produit :

- Taux de victoire par stratégie et par paire de stratégies.
- Taux de victoire par style joué et par palier, à énergie égale.
- Répartition des matchs 2–0 / 2–1, taux de manches nulles.
- Valeur moyenne d'un point d'énergie selon la manche.
- Impact du timing : écart de taux de victoire entre un joueur « 60 % parfaits » et « 20 % parfaits ».

### Seuils d'alerte

| Mesure | Zone saine |
|---|---|
| Taux de victoire d'un style à niveau égal | 47–53 % |
| Meilleure stratégie contre l'aléatoire | ≤ 80 % |
| Stratégie « tout sur une manche » contre « économe » | 40–60 % |
| Manches nulles | ≤ 3 % |
| Matchs en 3 manches | 30–55 % |
| Avantage d'un bon timeur (60 % vs 20 % de parfaits) | 60–75 % de victoires |
| **Talent contre budget** | **55–85 % de victoires** |

Chaque ajustement de `balance.ts` s'accompagne d'un rapport de simulation avant/après dans `docs/balance/AAAA-MM-JJ-sujet.md`.

### Mesure du skill

Le tournoi répond à « une façon de dépenser l'énergie domine-t-elle ? ». Il ne répond pas à
« le talent paie-t-il ? » — un jeu peut avoir cinq stratégies parfaitement équilibrées et ne
récompenser aucune adresse. `packages/rules/src/sim/skill.ts` pose la seconde question sous
forme de duels où **une seule variable diffère** entre les deux sièges :

| Duel | Ce qui diffère | Ce qu'on lit |
|---|---|---|
| Timing | 60 % de parfaits contre 20 % | Ce que vaut la jauge seule |
| Lecture | Contrer le dernier style contre le jouer au hasard, face à un adversaire prévisible (75 % du même style) | Ce que vaut le contre |
| Budget | 8 d'énergie par manche contre 4 | Ce que vaut l'énergie seule |
| **Talent contre budget** | Lire + viser juste avec 4, contre prévisible + maladroit avec 8 | **Si le jeu prime sur la dépense** |

Les sondes **changent de siège à mi-parcours** : sans cela un biais de siège du moteur serait
compté comme du talent. Un cinquième duel oppose deux sondes identiques et sert de témoin —
il doit rester proche de 50 %.

Le seuil « talent contre budget » est le garde-fou chiffré de l'intention produit. Sous 55 %,
l'énergie excédentaire pèse plus que le jeu. Au-dessus de 85 %, le budget ne décide plus rien
et l'un des quatre piliers de `docs/00-vision.md` est vide.

Commande : `pnpm sim --matches 10000` (les duels jouent un dixième de ce nombre chacun, car
ils coûtent cinq matchs là où le tournoi en coûte un ; `--skill N` fixe ce nombre).
