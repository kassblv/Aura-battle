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
| Charge | k6 (WebSocket) ou Artillery | Matchs simultanés, latence de traitement |
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
