# 01 — Game design PvP (fait foi)

Toutes les valeurs de ce document vivent dans `packages/rules/src/balance.ts`. Toute modification de valeur met à jour ce document.

## 1. Vue d'ensemble d'un match

- 2 joueurs, **premier à 2 manches gagnées**, 3 manches maximum.
- Chaque joueur commence avec **14 points d'énergie** pour tout le match.
- Déroulé d'une manche :
  1. **Intro** (2 s)
  2. **Recharge** (6 s, simultanée) : taper des orbes pour gagner un boost d'aura, de la jauge d'Ultime et un peu d'énergie.
  3. **Choix** (15 s max, simultané et secret) : une pose (qui porte une famille et un palier), amplificateur, activation éventuelle de l'Ultime, puis jauge de timing.
  4. **Révélation** (≈ 4,5 s) : révélation des deux auras, résolution des contres, choc, vainqueur de la manche.
- Fin : vainqueur, variation de classement, récompenses.

## 2. Poses, familles et contres

Le score dépend d'un **mouvement** = une **famille** et un **palier**. Le joueur
choisit une **pose** : chaque pose appartient à une case (famille × palier), et
toutes les poses d'une même case sont **strictement équivalentes** au score. Le
moteur (`@aura/rules`) ne voit jamais la pose, seulement le mouvement : c'est ce
qui garantit qu'aucune pose achetée n'est plus forte qu'une autre (règle d'or
n°3, ADR 0014).

### La roue des cinq familles

| Famille | Icône | Bat | Perd contre |
|---|---|---|---|
| Calme | 🧊 | Hype, Acrobatie | Provoc, Prouesse |
| Hype | 🔥 | Provoc, Prouesse | Calme, Acrobatie |
| Provoc | 😏 | Calme, Acrobatie | Hype, Prouesse |
| Acrobatie | 🤸 | Hype, Prouesse | Calme, Provoc |
| Prouesse | 💪 | Calme, Provoc | Hype, Acrobatie |

- Construction : sur le cercle Calme → Hype → Provoc → Acrobatie → Prouesse,
  chaque famille bat la suivante et celle à trois crans. C'est la seule roue à
  cinq où toutes ont le même profil. Les trois contres historiques (🧊 > 🔥 > 😏
  > 🧊) sont conservés.
- Deux familles différentes ont **toujours** un vainqueur : face à un choix au
  hasard, 40 % de contrer, 40 % d'être contré, 20 % de miroir.
- Contrer (famille qui bat celle de l'adversaire) : **×1,35** sur son score.
- Être contré : **×0,85** sur son score.
- Même famille des deux côtés : aucun effet.

### Paliers

| Palier | Nom affiché | Puissance | Coût en énergie |
|---|---|---|---|
| 0 | Souffle | 11 | 0 |
| 1 | Éclat | 20 | 1 |
| 2 | Vague | 30 | 2 |
| 3 | Orage | 42 | 3 |
| 4 | Apogée | 56 | 4 |

Le nom est du vocabulaire, pas de l'équilibrage : il vit dans
`packages/content/src/naming.ts` et aucune valeur de score n'en dépend. Il doit
valoir pour les cinq familles — un palier 4 calme est une lévitation, un palier 4
hype une danse du bateau, et « Apogée » couvre les deux.

L'interface montre le nom **et** les chiffres : cacher la puissance et le coût
rendrait le choix opaque, et c'est sur eux que se décide une manche.

### Les 25 cases et leurs poses

Chaque case a **une pose offerte à tous**, la première de la liste. Les autres
sont des variantes qui s'obtiennent en jouant ou avec des jetons, et ne sont
jamais plus fortes.

| Palier | Calme 🧊 | Hype 🔥 | Provoc 😏 | Acrobatie 🤸 | Prouesse 💪 |
|---|---|---|---|---|---|
| 0 | **Bras croisés**, Mains dans le dos | **Dab** | **Chut**, Doigt vers le ciel | **Saut applaudi**, Saut étoile | **Biceps contractés**, Squats |
| 1 | **Main dans la poche**, Marche assurée | **Six Seven**, Épaules qui roulent | **Doigt pointé**, T-pose | **Roulade**, Saut groupé | **Pompes**, Pompes claquées |
| 2 | **Regard au loin**, Mains en couronne | **Poing levé**, Floss, Célébration de but | **Mewing**, Haussement d'épaules, Applaudissement lent | **Roue**, Grand écart sauté | **Planche**, Chaise invisible |
| 3 | **Méditation**, Moonwalk, Coup de pied lent | **Griddy** | **L sur le front**, Épaules époussetées | **Toupie**, Vrille | **Poirier**, Squat sur une jambe |
| 4 | **Lévitation** | **Danse du bateau** | **Dos tourné**, Révérence | **Salto arrière**, Salto avant | **Drapeau humain**, Équerre |

En gras : la pose offerte. 49 poses au total, 25 offertes et 24 variantes : chaque case d'Acrobatie et de Prouesse a désormais la sienne. Voir
`07-content-pipeline.md` pour les noms à revoir avant publication.

Chaque famille garde sa voix : `calme` est posé et maîtrisé, `hype` explose,
`provoc` nargue, `acrobatie` vole, `prouesse` montre sa force.

### Carte brillante ✨

À chaque manche, le serveur tire au sort **une case** (famille × palier) pour
**chaque joueur**, séparément et uniformément parmi les 25 cases (graine du
match, flux `shiny`).

- Jouer une pose de sa case brillante multiplie le score de la manche par
  **×1,2** (`BALANCE.shiny.multiplier`). Le facteur s'ajoute aux autres, avant
  les contres.
- Chaque joueur n'apprend que **sa** case, dans son `choice:start`. L'adversaire
  sait seulement qu'une brillante existe quelque part. Les deux sont révélées
  dans `round:result`.
- **Égalité** : même tirage pour tous, rien à acheter, et chaque case a une pose
  offerte (règle d'or n°3).
- ×1,2 reste en dessous d'un contre (×1,35 / ×0,85). En simulation, jouer
  systématiquement sa brillante gagne 40 % des matchs, contre 67 % pour lire
  l'adversaire (`docs/balance/2026-09-24-carte-brillante.md`).
- L'IA vise sa brillante une manche sur trois quand elle est abordable
  (`shinyAppetite`).

## 3. Amplificateurs d'aura

L'amplificateur s'affiche sous le nom de son effet offert — il n'a pas de nom
séparé. Deux vocabulaires pour la même chose finiraient par se contredire, et
c'est cet effet-là que le joueur voit tourner autour de son aura.

| Niveau | Nom affiché (= effet offert) | Multiplicateur | Coût |
|---|---|---|---|
| A0 | Lueur | ×1,00 | 0 |
| A1 | Étincelles | ×1,12 | 1 |
| A2 | Éclairs | ×1,25 | 2 |
| A3 | Vortex | ×1,40 | 3 |
| A4 | Galaxie | ×1,55 | 4 |

Les autres effets du prototype (Flammes, Onde de choc, Aura noire) deviennent des skins cosmétiques d'un niveau.

**Pourquoi ces multiplicateurs sont resserrés.** Le palier sature à un coût de 4 : deux
joueurs qui dépensent 8 et 4 jouent tous les deux au palier 4. Tout l'écart de budget passe
donc par l'amplificateur, et lui seul décide de ce que vaut l'énergie excédentaire. Le talent
réuni — contre gagné (×1,35) et timing parfait (×1,50) — vaut ×2,03 ; l'amplificateur maximal
doit rester en dessous, sinon le budget l'emporte sur le jeu. Mesures et méthode dans
`docs/balance/2026-09-17-talent-contre-budget.md`.

Coût total d'une manche = coût du palier + coût de l'amplificateur (8 maximum). Un choix dont le coût dépasse l'énergie restante est refusé par le serveur.

## 4. Recharge

- Durée **6 000 ms**, simultanée pour les deux joueurs.
- Le serveur génère la séquence d'orbes à partir d'une graine : position (x, y normalisés 0–1), instant d'apparition, durée de vie, type.
- **3 orbes** visibles en permanence ; une orbe touchée ou expirée est remplacée par la suivante de la séquence.
- Orbe normale : 1 point, durée de vie 1 600 ms. Orbe dorée : 3 points, durée de vie 950 ms, probabilité 13 %.
- Combo : taper dans le vide ou laisser expirer une orbe remet le combo à 0. À partir de **10 d'affilée**, chaque orbe rapporte **+1**. Le bonus s'applique **dès la 10e orbe** (10 d'affilée rapportent donc 11 points).
- Un tap **rejeté** (orbe déjà morte, ou au-delà du plafond de 12 taps/s) est ignoré : il ne rapporte rien, mais **ne casse pas le combo**. Un tap rejeté n'a pas eu lieu, il n'est pas un échec — cela protège le joueur dont la latence fait taper une orbe encore affichée chez lui mais déjà expirée côté serveur.
- Gains :
  - **Boost d'aura** de la manche : +1 % par point, **25 % maximum**.
  - **Jauge d'Ultime** : +2,5 par point, **40 maximum** par recharge.
  - **Énergie** : +1 tous les 8 points, **+2 maximum** par manche, sans dépasser 14.
- Plafond de validation : 12 taps comptabilisés par seconde (au-delà, taps ignorés et signalés à l'anti-triche).

## 5. Timing

- Le serveur envoie les paramètres de la jauge au début de la phase de choix : période (1 500–1 900 ms, tirée par graine), largeur de la zone (0,22), largeur du parfait (0,08), centre (0,30–0,70).
- Position du curseur : onde triangulaire `p(t) = u < 0,5 ? 2u : 2 − 2u` avec `u = (t mod période) / période`, où `t` est le temps écoulé depuis le lancement de la charge.
- Qualité selon l'écart `|p − centre|` :

| Qualité | Condition | Multiplicateur |
|---|---|---|
| Parfait | ≤ parfait / 2 | ×1,50 |
| Bon | ≤ zone / 2 | ×1,15 |
| Raté | sinon | ×0,60 |

- L'écart exact est conservé pour départager les égalités.
- La charge dure au plus 6 000 ms ; sans tap, la qualité est « Raté ».

## 6. Ultime

- Jauge 0–100, conservée entre les manches.
- Gains : parfait +40, contre réussi +35, manche perdue +25, recharge (voir §4).
- Activable à la phase de choix si la jauge est pleine : **×1,5** et **impossible à contrer**. Si l'adversaire avait la famille gagnante, son contre est annulé (« Contre bloqué ») et il ne subit pas de malus.
- L'activation vide la jauge.

## 7. Calcul du score d'une manche

```
base  = puissance(palier) × mult(amplificateur) × mult(timing) × (répétition ? 0,7 : 1)
        × (Ultime ? 1,5 : 1) × (1 + boost / 100)
final = base × (contre ? 1,35 : 1) × (contré ? 0,85 : 1)
score = arrondi(final)
```

- **Répétition :** rejouer exactement le même mouvement (famille + palier) qu'une manche précédente du match.
- **Pas d'aléatoire dans le score en PvP.** Le hasard ne porte que sur la génération des orbes et de la jauge, identique pour les deux joueurs dans une manche.
- Vainqueur de la manche : score le plus élevé. En cas d'égalité, le plus petit écart de timing gagne. Si l'égalité persiste, manche nulle.

## 8. Fin de match et départage

1. Premier à 2 manches gagnées.
2. Après 3 manches sans vainqueur : plus de manches gagnées, puis plus haut total de scores, puis plus petite somme des écarts de timing, puis match nul.
3. Abandon ou déconnexion définitive : victoire de l'autre joueur.

## 9. Délais et actions par défaut

- Phase de choix sans verrouillage à l'échéance : pose offerte du palier 0 d'une famille tirée par la graine de la manche, A0, sans Ultime, timing « Raté ».
- Deux manches consécutives sans aucune action du joueur : forfait.

## 10. Bulle d'intention (optionnelle, à tester en bêta)

Mécanique inspirée de la bulle de pensée du prototype : pendant la phase de choix, chaque joueur peut afficher publiquement une famille (vraie ou bluff). S'il gagne la manche avec la famille annoncée : +10 de jauge d'Ultime (`BALANCE.intent.ultimateBonus`, plafonné comme le reste). **Une seule annonce par manche**, avant son verrouillage — la première fait foi. Activée par feature flag, désactivée par défaut (`BALANCE.intent.enabled`) : le serveur l'active match par match, en test A/B, en partie rapide et en invitation seulement (spec `docs/superpowers/specs/2026-09-26-bulle-intention-ab-design.md`).

## 11. Méta hors match

- **Classement :** voir `05-matchmaking-ranking.md`.
- **Défis quotidiens** (validés côté serveur) : contres, parfaits, victoires, points de recharge, combos.

  **Trois par jour**, tirés d'une réserve de dix, jamais deux fois la même
  mesure dans la journée — trois objectifs qui comptent la même chose feraient
  une journée à objectif unique, et un joueur qui n'aime pas cette mesure-là
  n'aurait rien à faire ce jour-là. Le tirage est **déterministe à partir du
  numéro du jour** : rien de la sélection n'a besoin d'être stocké, et un
  redémarrage du serveur ne change pas la journée en cours.

  **Minuit UTC pour tout le monde.** Un découpage par fuseau obligerait à
  stocker celui de chaque joueur et à décider ce qui arrive quand il voyage —
  deux problèmes créés pour une journée qui commence de toute façon au moment
  où le joueur ouvre le jeu.

  **Récompense : de 30 à 95 pièces douces**, soit 145 à 235 par journée
  complète. Calé sur la boutique : une danse d'entrée vaut 90, une tenue
  moyenne 280, l'article le plus cher 1 500. Une journée entièrement remplie
  paie donc à peu près une danse d'entrée ; une semaine complète, l'article le
  plus cher du catalogue. C'est un rythme, pas une grille de production.

  **Un combo est un maximum, pas une somme.** « Atteindre un combo de 14 » ne
  s'obtient pas en cumulant quatre combos de trois. Le catalogue porte donc
  `accumulate: 'best'` sur cette mesure et `'sum'` sur les quatre autres.
- **Vitrine du jour :** trois articles payants mis en avant à **−30 %**, et
  **rien n'est caché**. Avec une trentaine d'articles au catalogue, masquer le
  reste derrière une rotation ferait attendre des semaines quelqu'un qui veut
  une danse précise ; la vitrine s'ajoute, tout le reste demeure achetable au
  prix plein.

  Les articles défilent sur un **cycle**, pas un tirage. Deux conséquences
  qu'un tirage ne donne pas : la vitrine d'hier ne peut pas revenir aujourd'hui
  — une vitrine qui se répète ne donne aucune raison de revenir — et **l'attente
  est bornée**, chaque article passant une fois par tour (cinq jours). Quelqu'un
  qui en veut un précis sait qu'il viendra, et quand.

  **Le prix remisé se décide côté serveur**, avec le prix du catalogue et le
  jour de son horloge. Le client ne l'envoie pas et ne pourrait pas : il
  annoncerait « cet article est en vitrine » et achèterait tout à −30 %. Règle
  d'or n°1.

- **Niveau de joueur.** L'expérience était déjà calculée — 30 pour une victoire,
  18 pour une égalité, 12 pour une défaite — envoyée dans `match:end`, et écrite
  nulle part. C'est pourtant **le seul compteur qui monte même quand on perd**,
  donc le contrepoids des LP, qui descendent : sans lui une soirée de défaites ne
  laisse rien derrière elle.

  Courbe géométrique (`BALANCE.progression`) : 100 d'expérience pour le premier
  palier, puis +8 % à chaque niveau, jusqu'au niveau 50. Cela place le niveau 2 à
  cinq matchs — dans la **première session**, la seule qui décide si quelqu'un
  revient — le niveau 20 vers 7 heures de jeu et le niveau 50 vers 88. À +12 %, le
  niveau 50 demandait 350 heures : un plafond que personne n'atteint n'est pas un
  horizon, c'est une décoration.

  Le niveau se **déduit** du cumul (`levelFor`, `@aura/rules`), il n'est pas
  stocké à côté : deux colonnes qui décrivent la même chose finissent par se
  contredire, et c'est toujours celle qu'on a oublié de mettre à jour qui
  s'affiche.

- **Événements de la semaine** (partie rapide seulement ; le classé reste la référence). Une semaine sur deux, une variante de règles déclarée en donnée (`RULE_VARIANTS`, `@aura/rules`), tournant chaque lundi (UTC) : **Semaine brillante** (brillante ×1,5), **Contres tranchants** (contre ×1,6), **Ultime express** (jauge d'Ultime à 60) — valeurs dans `EVENT_BALANCE` (`balance.ts`), et les annonces les citent. Jamais d'énergie en plus : mesuré, elle rendait « toujours le plus gros » dominant (`docs/balance/2026-09-25-evenements.md`).
- **Changement de saison : on repart plus bas, jamais de zéro.** Au premier match de la saison, les LP de la précédente sont divisés par deux, le MMR se resserre de 20 % vers 1 000, et cinq matchs de placement se rouvrent (`docs/05`, `seasonCarryOver`). Repartir de zéro effacerait la raison de revenir ; ne rien réinitialiser figerait le haut du classement.
- **Passe de saison.** Un horizon daté : 30 paliers de 100 XP de saison
  (`SEASON_PASS`, `@aura/content`). L'**XP de saison** est l'expérience de chaque
  match joué pendant la saison, créditée dans la même transaction que l'XP du
  joueur ; rien hors saison, rien pour un siège fantôme ni un abandon (0 XP).
  - **Piste gratuite** : 40 pièces par palier, 5 jetons aux paliers 5, 15 et 25,
    un cosmétique aux paliers 10, 20 et 30.
  - **Piste premium** : **500 jetons**, jamais d'argent directement. Elle rend
    200 jetons sur la saison et des cosmétiques plus rares. Achetable à tout
    moment : les paliers déjà atteints deviennent réclamables d'un coup.
  - **Réclamer** : un appui par récompense, ou « Tout récupérer ». Le serveur
    seul juge l'XP, le palier, la piste et ce qui est déjà réclamé ; le client
    n'envoie qu'un palier et une piste. Refus, dans cet ordre : palier inconnu,
    déjà réclamé, palier non atteint, premium requis — « non atteint » passe
    avant « premium requis » pour ne jamais pousser à acheter une piste qui ne
    donnerait rien tout de suite.
  - **Un cosmétique déjà possédé se change en pièces**, à son prix du catalogue,
    **40 pièces au moins** (`OWNED_ITEM_MIN_COINS`) : un objet offert à tous vaut
    zéro au catalogue, et une récompense n'est jamais vide. Même conversion pour
    un objet que le catalogue ne connaît pas.
  - Les récompenses non réclamées à la fin de la saison sont perdues : sans
    saison courante, plus rien ne se réclame.

  **Exclusifs de saison** : certains cosmétiques ne se gagnent QUE sur le passe (champ `exclusive`, « Saison 1 ») — ni en boutique, ni en vitrine, ni offerts. La saison 1 en a deux : la couleur Aurore (palier premium 22) et la Tenue d'Aurore (palier premium 30). Les paliers premium 22 et 26 payaient 60 pièces chacun : ils portent désormais l'Aurore et les 20 jetons déplacés du palier 30. La piste premium rend toujours 200 jetons, et 120 pièces de moins — échangées contre l'exclusif. Leur prix de 0 veut dire « ne se vend pas » ; toute règle qui lit « 0 = offert » vérifie d'abord `isExclusive`.
- **Monnaie douce** (◈ pièces) gagnée en jouant ; **monnaie dure** (💎 jetons). Toutes deux ne servent qu'au cosmétique et au passe de saison.
  - **Les jetons se gagnent aussi en jouant** : dix par niveau franchi (`BALANCE.progression.tokensPerLevel`). Le niveau 2, dans la première session, paie une pose commune.
  - **Dix pièces pour un jeton** : chaque article payant a un prix en jetons, arrondi au-dessus (`tokenPrice`). La vitrine remise aussi les jetons.
  - **Le joueur choisit sa monnaie** à l'achat ; celle qu'il choisit est la seule prélevée.
  - L'achat de jetons avec de l'argent réel (achats intégrés des stores) n'est pas encore construit (ADR 0015).
- **Solo :** entraînement contre les 4 IA du prototype, adaptées aux règles ci-dessus (tableaux d'IA dans `packages/rules/src/ai`).
