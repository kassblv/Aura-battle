# La main de cartes — chantier n°2 (écran de choix)

Date : 2026-09-24 · Statut : section 1 validée en discussion ; spec en relecture

Suite du chantier n°1 (`2026-09-24-poses-cinq-familles-design.md`, ADR 0014).

## Pourquoi

Depuis le chantier n°1, le duel se joue avec des **poses**, mais l'écran de choix
montre encore des abstractions :
- cinq boutons de famille ;
- une échelle de paliers aux noms génériques (Souffle… Apogée) ;
- un bouton « danse suivante ».

Le joueur ne *voit* pas la pose qu'il va jouer avant de l'avoir choisie. Le
joueur l'a demandé : mieux montrer les poses, et **maximiser le plaisir de
jouer** (« un maximum de dopamine »), sans s'interdire un effet aléatoire.

Réussi si :
- on comprend l'écran du premier coup d'œil ;
- choisir est agréable au toucher ;
- chaque manche réserve une petite surprise ;
- rien de tout cela ne coûte de la lisibilité pendant les 15 secondes du choix.

## Décisions prises en discussion

| Question | Choix |
|---|---|
| Disposition | **Main de cartes en éventail** au centre-bas (option B) |
| Illustration d'une carte | **Pictogramme par pose** (emoji), une donnée du fichier de la pose |
| Plusieurs poses possédées dans une case | **Empilées** : retoucher la carte choisie la retourne sur la variante suivante |
| Poses non possédées | **Discrètes** : seulement comptées dans le badge (« +2 à débloquer ») |
| Ressenti, effet aléatoire | Laissés à l'initiative de la conception (« fais ce que tu penses le mieux ») |

## 1. L'écran (validé)

Format 844×390, **rien ne défile**, cibles tactiles ≥ 46 px (ADR 0008).

- **La main**, au centre-bas : 5 cartes en éventail, une par palier. Chaque carte
  porte :
  - le nom du palier ;
  - le pictogramme de la pose ;
  - le nom de la pose ;
  - la puissance, en doré ;
  - le coût en énergie.

  La carte choisie se soulève, grandit et s'illumine.
- **Cinq onglets de famille** au-dessus de la main. Chacun rappelle en petit les
  deux familles qu'il bat (🤸 bat 💪🔥).
- **À droite, l'amplificateur**, en colonne. **À gauche, l'Ultime et la jauge de
  timing.** L'énergie restante reste visible.
- **Gestes :**
  - toucher un onglet affiche la main de sa famille ;
  - toucher une carte la choisit : la jauge s'arme, et le personnage prend
    l'aperçu local de la pose, sans rien envoyer au serveur (règle d'or n°4) ;
  - **retoucher la carte choisie la retourne** sur la variante possédée
    suivante. Le badge indique « ×2 · +1 » (2 possédées, 1 à débloquer), et la
    variante devient la présélection de la case (`loadout.dances`) ;
  - une carte **trop chère est grisée**, mais reste touchable en aperçu, avec
    « il te manque N énergie », comme l'amplificateur aujourd'hui ;
  - toucher ailleurs, une fois la jauge armée, verrouille. C'est le geste actuel.
- **Caméra :** pendant la phase de choix, elle remonte juste assez pour que la
  main ne coupe pas les jambes des combattants. C'est mesuré à l'écran, comme pour
  l'accueil (`CLAUDE.md`, « le sujet est au milieu »).

## 2. Le ressenti : chaque geste répond

Tous les effets passent par `transform` et `opacity` (le compositeur, sans
re-rendu React) et respectent `prefers-reduced-motion`. Les sons et les
vibrations réutilisent `audio/cues.ts` et `platform/haptics.ts`.

| Moment | Visuel | Son | Vibration |
|---|---|---|---|
| Début du choix | les 5 cartes sont **distribuées** de la pile vers l'éventail, décalées de 45 ms | un « flip » par carte, en montée de hauteur | tic léger à la dernière |
| Changer de famille | la main se replie et se redistribue (120 ms) | glissement | — |
| Toucher une carte | soulèvement avec ressort (léger rebond), halo | « pop » | léger |
| Retourner sur une variante | rotation 3D d'un demi-tour, le pictogramme change à mi-course | « flip » | léger |
| Carte trop chère | petit tremblement latéral, « il te manque N » | son sourd | — |
| Verrouiller | la carte **s'écrase** vers le personnage, flash de sa couleur de famille, légère secousse de l'écran | « slam » grave | moyen |
| Carte brillante ✨ en main | reflet holographique qui balaie la carte en boucle, étincelles | tintement à la distribution | tic léger |

## 3. L'effet aléatoire : la carte brillante ✨

**Règle.** À chaque manche, le serveur tire au sort **une case** (famille ×
palier) pour chaque joueur, séparément.
- Si le joueur verrouille une pose de cette case, son score de manche est
  multiplié par **×1,2** (`BALANCE.shiny.multiplier`).
- Le tirage est uniforme sur les 25 cases, seedé (`deriveSeed(seed, 'shiny',
  round, seat)`), donc **déterministe et rejouable**. Le moteur reste pur.

**Pourquoi c'est sain :**
- **Égalité.** Chaque joueur en a une, par le même tirage. Elle ne s'achète pas et
  ne dépend de rien de possédé : la règle d'or n°3 tient, puisque chaque case a
  une pose offerte.
- **Pas de fuite.**
  - Le joueur apprend **sa** case dans son propre `choice:start`. L'adversaire
    n'en sait rien avant `round:result` (règle d'or n°4).
  - L'adversaire sait seulement qu'une carte brillante existe quelque part. Le
    bluff s'enrichit : un ×1,2 vaut-il de jouer une famille qui se fait contrer ?
- **Mesuré.** ×1,2 reste en dessous d'un contre (×1,35 / ×0,85). La simulation
  doit confirmer que les seuils de `docs/09` tiennent (familles 47–53 %), et que
  « toujours jouer la brillante » ne domine pas « lire l'adversaire ».
- **À la révélation :** `round:result` indique `shiny: true` pour chaque siège
  concerné. La mise en scène (éclat, « ✨ ×1,2 ») relève du chantier n°3, mais un
  badge minimal apparaît dès ce chantier sur le score.

**Changements :**
- `@aura/rules` :
  - `BALANCE.shiny` ;
  - `RoundContext.shiny: Record<Seat, Move>` ;
  - un facteur de score dans `resolveRound` ;
  - l'IA vise sa brillante une manche sur trois quand elle en a les moyens (`shinyAppetite: 0.35` dans ses profils), sinon elle joue comme aujourd'hui ;
  - un nouveau scénario de simulation.
- `@aura/protocol` passe en **2.1.0** (ajouts compatibles) :
  - `choice:start.shiny: { style, tier }` pour le destinataire seulement ;
  - `round:result.sides.*.shiny: boolean`.
- Le serveur construit `choice:start` par siège (la vue existe déjà), et un test
  vérifie que la brillante d'un siège ne part jamais chez l'autre.
- `docs/01` gagne une section « Carte brillante » avec sa valeur.

**Risque connu, accepté :** la graine du match se reconstitue à partir des orbes
(docs/08, M7). Un tricheur pourrait donc calculer la brillante adverse. Le joueur
a décidé que l'anti-triche n'est pas prioritaire pour l'instant. Le correctif
de la graine secrète la couvrira aussi.

## 4. Le pictogramme : de la donnée

- Champ **`icon`** (un emoji) **obligatoire** pour toute animation de mouvement,
  facultatif pour les animations système. Schéma JSON et `loadAnimation` mis à
  jour.
- Test de contenu : chaque pose en a un, et **aucun doublon** au sein d'une même
  famille.
- Ajouter une pose = un fichier JSON avec son `icon` : aucun code (règle d'or n°5).

**Proposition des 39 pictogrammes** (à relire) :

| Famille | Palier 0 | Palier 1 | Palier 2 | Palier 3 | Palier 4 |
|---|---|---|---|---|---|
| Calme 🧊 | Bras croisés 🙅 · Mains dans le dos 🤵 | Main dans la poche 👖 · Marche assurée 🚶 | Regard au loin 👀 · Mains en couronne 👑 | Méditation 🧘 · Moonwalk 🌙 · Coup de pied lent 🦵 | Lévitation ☁️ |
| Hype 🔥 | Dab 🤙 | Six Seven 🎲 · Épaules qui roulent 🕺 | Poing levé ✊ · Floss 🧵 · Célébration de but ⚽ | Griddy 🐾 | Danse du bateau 🚣 |
| Provoc 😏 | Chut 🤫 · Doigt vers le ciel ☝️ | Doigt pointé 👉 · T-pose 🛩️ | Mewing 🗿 · Haussement d'épaules 🤷 · Applaudissement lent 🙄 | L sur le front 😜 · Épaules époussetées 🧹 | Dos tourné 🔙 · Révérence 🎩 |
| Acrobatie 🤸 | Saut applaudi 🙌 | Roulade 🌀 | Roue 🤸 | Toupie 🌪️ | Salto arrière 🔄 |
| Prouesse 💪 | Biceps contractés 💪 | Pompes 🏋️ | Planche 🪵 | Poirier 🙃 | Drapeau humain 🚩 |

## 5. Architecture côté client

- **`app/hand.ts`**, un module pur et testé : `handFor(input)` rend les 5 cartes
  d'une famille. Chaque carte donne :
  - le palier, la pose affichée, son pictogramme, son nom ;
  - la puissance et le coût ;
  - `affordable` ;
  - `variants: { index, owned, toUnlock }` ;
  - `shiny`.

  Il prend en entrée la famille, la garde-robe, l'énergie disponible, la case
  brillante et les présélections.

  `nextVariant(card)` rend la pose suivante. Toute la logique de la main vit ici,
  hors de React.
- **`app/PoseHand.tsx`** : les onglets de famille et l'éventail. Monté une fois
  pour tout le match, comme la bande de commandes actuelle, pour ne jamais monter
  30 éléments à l'instant où la jauge apparaît. Mémoïsé, avec des propriétés
  primitives ou stables.
- **`ControlBand`** perd la grappe « Style », l'échelle de paliers et le bouton
  « danse ». Il garde l'Ultime, la jauge et l'amplificateur, réorganisés en deux
  colonnes latérales.
- **Retirés** : `STYLE_ROWS` et l'échelle de paliers de `MatchScreen`. Le pas
  `STYLE_COLUMNS` de `ui/layout.ts` n'est plus utilisé.
- **Styles :**
  - blocs préfixés (`hand__card`, `hand__tab`) ;
  - chaque classe a sa règle (`styles.test.ts`) ;
  - le point de bascule tombe du bon côté de 844×390.
- **Solo** : même écran, même main. L'IA solo reçoit aussi une carte brillante (le
  moteur la tire).

## Hors périmètre

- La mise en scène de la révélation : carte adverse retournée, éclat de la
  brillante, explication du contre (chantier n°3).
- La qualité des animations 3D (chantier n°4).
- La boutique et les jetons, ainsi que les variantes nouvelles pour Acrobatie et
  Prouesse (chantier n°5).

## Critères d'acceptation

- [ ] `hand.ts` testé :
  - 5 cartes par famille, dans l'ordre des paliers ;
  - la variante présélectionnée, sinon l'offerte ;
  - le cycle des variantes possédées ;
  - le compte « à débloquer » ;
  - `affordable` selon l'énergie ;
  - le drapeau `shiny`.
- [ ] Contenu : `icon` présent sur les 39 poses, sans doublon par famille, validé par le schéma.
- [ ] Règles :
  - la brillante multiplie par 1,2 le score de la case tirée, et seulement celle-là ;
  - tirage déterministe et uniforme (fast-check) ;
  - `docs/01` et `balance.ts` à jour.
- [ ] Simulation : seuils de `docs/09` tenus avec la brillante, et un rapport dans `docs/balance/`.
- [ ] Protocole 2.1.0 :
  - `choice:start.shiny` n'est envoyé qu'au siège concerné (test de vue) ;
  - `round:result` porte `shiny`.
- [ ] À l'écran, 844×390 :
  - la main ne coupe pas les combattants (mesure) ;
  - aucune cible sous 46 px ;
  - rien ne défile ;
  - vérifié en capture pendant un vrai duel.
- [ ] Ressenti : distribution, soulèvement, retournement, tremblement, écrasement au verrouillage et reflet de la brillante présents, avec son et vibration. Mouvement réduit respecté.
- [ ] Fluidité : aucun re-rendu React par image pendant le choix, et pas de montage au début de la phase (mesuré comme dans `MatchScreen`).
- [ ] `security-reviewer` relit le protocole et la vue par siège de `choice:start`.
- [ ] `pnpm lint`, `pnpm typecheck --force`, `pnpm test --force` verts.
