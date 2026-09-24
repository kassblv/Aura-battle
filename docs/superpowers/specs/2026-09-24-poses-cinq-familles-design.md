# Poses jouables et cinq familles — chantier n°1 (cœur)

Date : 2026-09-24 · Statut : validé en discussion, en relecture

## Pourquoi

En duel, le joueur choisit aujourd'hui un **style** parmi trois (Calme, Hype,
Provoc), un palier et un amplificateur. Deux problèmes :

1. **La profondeur.** Un pierre-feuille-ciseaux à trois est trop pauvre pour
   porter la lecture et le bluff d'un jeu compétitif.
2. **Les poses sont absentes du choix.** Le contenu compte 33 poses — Dab,
   Griddy, Mewing, Salto arrière… — mais elles ne sont qu'un skin équipé
   d'avance. Une pose achetée ne se *joue* pas, elle se porte.

Ce que le joueur a demandé : choisir des poses en duel, toutes celles d'une
vraie *aura battle* ; plus de familles de contres ; des poses qu'on peut
gagner en jouant ou débloquer plus vite avec des jetons, et **jouer celles
qu'on a obtenues**.

## Découpage

Ce document couvre le **chantier n°1**. Les suivants auront chacun leur spec.

| n° | Chantier | Contenu |
|---|---|---|
| **1** | **Cœur** | règles à 5 familles, contenu (25 cases), protocole 2.0.0, serveur, IA, simulation |
| 2 | Écran de choix | cartes de pose à la place des boutons abstraits |
| 3 | Révélation | nom des poses, mise en scène du contre, caméra |
| 4 | Animations 3D | poses plus fluides et plus spectaculaires |
| 5 | Vestiaire et boutique | parcourir, essayer, acheter des poses ; jetons |

Le chantier n°1 ne change à l'écran que ce qui est indispensable pour jouer :
deux boutons de famille de plus, et la pose choisie via le sélecteur existant.

## Nouvelle règle d'or n°3

> **Des poses de côté, jamais au-dessus.** Tout ce qui modifie un score
> s'obtient en jouant ; l'argent ne fait que raccourcir l'attente. Une pose
> achetable n'est jamais plus forte qu'une pose gratuite : le kit gratuit
> répond à tout.

Vérifiée par construction, et testée : le moteur ne reçoit jamais de pose,
seulement une famille et un palier, donc le score ne peut pas dépendre de ce
qu'on possède. Un test de contenu garantit que chaque case a une pose gratuite.
Une simulation « kit gratuit contre collection complète » donnerait 50 % par
construction et ne prouverait rien, d'où ces deux tests à sa place.
Mise à jour de `CLAUDE.md` et nouvel ADR.

## 1. Règles : la roue des cinq familles

| Famille | Icône | Bat | Perd contre |
|---|---|---|---|
| Calme | 🧊 | Hype, Acrobatie | Provoc, Prouesse |
| Hype | 🔥 | Provoc, Prouesse | Calme, Acrobatie |
| Provoc | 😏 | Calme, Acrobatie | Hype, Prouesse |
| Acrobatie | 🤸 | Hype, Prouesse | Calme, Provoc |
| Prouesse | 💪 | Calme, Provoc | Hype, Acrobatie |

- Construction : sur un cercle Calme, Hype, Provoc, Acrobatie, Prouesse, chaque
  famille bat la suivante et celle à trois crans. Les trois contres existants
  (🧊 > 🔥 > 😏 > 🧊) sont conservés.
- Chaque famille en bat exactement deux et perd contre exactement deux : aucune
  n'est dominante, et les multiplicateurs valent pour toutes les paires.
- Multiplicateurs de départ inchangés (×1,35 pour qui contre, ×0,85 pour qui est
  contré). La simulation décide s'il faut les ajuster (règle d'or n°6).
- Paliers, énergie, amplificateurs, Ultime, recharge et timing : **inchangés**.
- **Une pose = une famille + un palier.** Toutes les poses d'une même case ont
  exactement la même puissance.
- Choix par défaut à l'échéance : la pose gratuite du palier 0 d'une famille
  tirée par la graine de la manche, A0, sans Ultime, timing « Raté ».

## 2. Contenu : 25 cases, 39 poses

Chaque case (famille × palier) a **une pose gratuite**. Les autres sont des
variantes payantes de même puissance.

**Acrobatie 🤸** : les poses de voltige existantes y sont déplacées et
deviennent gratuites. Aucun joueur réel ne les a achetées : pas de
remboursement.

| Palier | Pose gratuite | Origine |
|---|---|---|
| 0 Souffle | Saut applaudi | Hype 0 |
| 1 Éclat | Roulade | **à créer** |
| 2 Vague | Roue | Hype 4 |
| 3 Orage | Toupie | Hype 3 |
| 4 Apogée | Salto arrière | Calme 4 |

**Prouesse 💪** : tout est à créer.

| Palier | Pose gratuite |
|---|---|
| 0 | Biceps contractés |
| 1 | Pompes |
| 2 | Planche (gainage) |
| 3 | Poirier |
| 4 | Drapeau humain |

**Calme, Hype, Provoc** gardent leurs autres poses. La pose gratuite de chaque
case reste celle d'aujourd'hui.

Total : 25 gratuites + 14 payantes = 39 poses, dont **6 animations à créer**,
au format existant (`packages/content/animations/<famille>/<id>.json`),
validées par le schéma et visibles dans la galerie. Les identifiants des poses
déplacées changent de préfixe (`anim.hype.t4.wheel` → `anim.acrobatie.t2.wheel`),
avec la mise à jour du seed et du catalogue qui va avec.

Ajouter une famille ne demande que de la donnée et des valeurs d'équilibrage ;
aucun écran ne code en dur la liste des familles (règle d'or n°5).

## 3. Moteur, protocole, serveur

### `@aura/rules`

Le moteur ne connaît que des **mouvements** (famille + palier), jamais des
poses : une pose est du contenu.

- `Style` passe à cinq valeurs : `calme`, `hype`, `provoc`, `acrobatie`,
  `prouesse`. Ce sont des exceptions assumées à la règle « identifiants en
  anglais » : les trois existants sont déjà ces mots, servent de clés dans le
  contenu, le protocole et la base, et deux conventions dans la même
  énumération se liraient comme une erreur.
- `styleBeats: Record<Style, Style>` devient
  `Record<Style, readonly Style[]>`.
- La résolution des contres de `round.ts` lit la liste.
- L'IA solo et le simulateur jouent les cinq familles.

### `@aura/protocol` 2.0.0 (changement cassant)

- `choice:lock` envoie `poseId` **au lieu de** `move`. Le client n'envoie que
  son intention ; le serveur déduit famille et palier de `@aura/content`.
- `round:result` révèle, pour chaque siège, la `poseId` **et** le `move`
  déduit. Rien n'est envoyé avant (règle d'or n°4).
- `styleSchema` passe à cinq valeurs.
- `loadout.dances` change de rôle : ce n'est plus la danse jouée à la
  révélation, mais la **pose présélectionnée** de chaque case (Vestiaire,
  bouton « pose suivante »). Le serveur ne s'en sert plus pour la révélation.
  `signature` reste.
- La poignée de main refuse un client 1.x avec un message « mets à jour le
  jeu ».

### Serveur

- Au verrouillage, le serveur vérifie la **possession** de la pose : une pose
  payante non possédée est refusée avec `NOT_OWNED`. Les poses gratuites sont
  possédées par tous (`isOffered`).
- Le choix par défaut suit la règle du §1.
- La révélation montre la pose verrouillée (`cosmetic.animationId` de
  `round:result`), ou la pose gratuite de la case pour un fantôme ou un choix
  par défaut. Le chemin « danse équipée par mouvement » du module `match`
  (`SeatWearing.dances`, `refreshDances`) disparaît.
- Le loadout est une colonne JSON : aucune migration Prisma.
- **Fantômes** : les enregistrements en trois styles restent valides tels quels
  et rejouent la pose gratuite de leur case. Acrobatie et Prouesse n'y
  apparaissent qu'au fil des nouveaux enregistrements. C'est une limite
  documentée, sans effet sur l'équité : le joueur ne sait pas quelles familles
  un fantôme utilise.

### Client (minimum pour jouer)

- Le panneau de choix affiche cinq familles, calculées à partir du contenu.
- Le sélecteur actuel (« danse suivante ») devient le choix de la pose parmi
  celles que le joueur possède dans la case. Aucun appel au serveur tant qu'on
  ne verrouille pas.
- Le vrai écran de cartes de pose relève du chantier n°2.

## Hors périmètre

Refonte de l'écran de choix (n°2), mise en scène de la révélation (n°3),
qualité des animations (n°4), boutique et jetons (n°5, qui s'appuiera sur la
colonne `hardCurrency` existante).

## Critères d'acceptation

- [ ] `rules` : la roue est testée par propriétés (fast-check) : chaque famille
      bat exactement deux autres, perd contre exactement deux, et aucune paire
      n'est à la fois gagnante et perdante.
- [ ] `pnpm sim --matches 10000 --strategy all` : taux de victoire par famille
      dans les seuils de `docs/09-testing.md`.
- [ ] `protocol` 2.0.0 : schémas testés, un client 1.x est refusé proprement.
- [ ] `match` e2e :
      - une pose non possédée est refusée ;
      - rien du choix ne sort avant `round:result` ;
      - la pose par défaut est appliquée à l'échéance ;
      - `round:result` porte la pose et le mouvement.
- [ ] Contenu : 25 cases ont chacune une pose gratuite (test) ; les 6 nouvelles
      animations passent le validateur et le contrôle de cadrage.
- [ ] Duel réel à deux navigateurs : une pose d'Acrobatie contre une de
      Prouesse, révélée correctement des deux côtés.
- [ ] `docs/01` (§2 réécrit), `docs/03` (protocole), `docs/07` (nouvelles
      poses), ADR « poses de côté », `CLAUDE.md` (règle n°3) mis à jour.
- [ ] `security-reviewer` relit `packages/protocol` et `apps/server/src/match`.
- [ ] `pnpm lint`, `pnpm typecheck --force`, `pnpm test --force` verts.
