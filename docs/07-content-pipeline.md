# 07 — Contenu : animations, cosmétiques et live-ops

## Principe

Le gameplay ne connaît que des **mouvements** (style + palier) et des **amplificateurs**. Tout ce qui se voit est du **contenu** en JSON, chargé par le client et validé par le serveur. Une nouvelle danse tendance = un fichier JSON + une entrée de catalogue, publiés sans mise à jour store.

## Format d'une animation

Schéma : `docs/content/animation.schema.json` (à copier dans `packages/content/schema/` au jalon M2).

```json
{
  "id": "anim.hype.t1.sixseven",
  "version": 1,
  "name": { "fr": "Six Seven" },
  "move": { "style": "hype", "tier": 1 },
  "rarity": "common",
  "framing": { "shot": "body" },
  "loop": { "duration": 0.72, "weights": null, "ease": false },
  "flags": { "armsFront": false, "armsBack": false, "noFace": false, "float": 0, "expression": "neutral" },
  "emit": ["6", "7"],
  "sound": [{ "at": 0.3, "accent": "whoosh" }, { "at": 0.66, "accent": "impact" }],
  "hands": [["open", "up"], ["open", "up"]],
  "frames": [
    {
      "joints": { "head": [2, -148], "neck": [1, -130], "hip": [1, -78], "le": [-10, -102], "lh": [14, -121], "re": [14, -104], "rh": [36, -95], "lk": [-8, -38], "lf": [-12, 0], "rk": [9, -38], "rf": [12, 0] },
      "z": { "lh": 4, "rh": -4 },
      "rot": 0.12, "hy": -0.15
    }
  ]
}
```

### Conventions de coordonnées (identiques au prototype)

- Unités : 1 unité = 1 cm. Personnage tourné vers +x, pieds au sol à y = 0, **y négatif vers le haut**.
- Articulations : `head, neck, hip, le, lh, re, rh, lk, lf, rk, rf` (`l*` = côté arrière, `r*` = côté avant ; `e` coude, `h` main, `k` genou, `f` pied).
- `z` : décalage de profondeur optionnel par articulation, positif vers la caméra pour le joueur de gauche.
- `lift` (≤ 0, saut), `rot` (rotation du corps, rad), `hy` (rotation de la tête, rad), `pitch` (salto, rad) : optionnels, 0 par défaut. Les angles sont interpolés par le plus court chemin.
- Interpolation Catmull-Rom en boucle, `ease: true` pour marquer des arrêts nets. `weights` = durée relative de chaque segment.
- Mains : `[[forme, paume], [forme, paume]]` pour [arrière, avant]. Formes : `relax, fist, open, point, L, peace`. Paumes : `in, up, down, fwd, back`.
- Expressions : `neutral, smug, sad, angry, hurt, joy` (`joy` : yeux plisses, bouche ouverte — la victoire).

### Cadrage de prévisualisation (`framing`)

Optionnel, `{ "shot": "body" }` par défaut.

| Valeur | Ce que la caméra montre | Pour quoi |
|---|---|---|
| `body` | Toute la silhouette, distance ajustée à l'encombrement réel de l'animation | Défaut. Le salto arrière, la lévitation et la T-pose sont cadrés plus large sans rien déclarer. |
| `bust` | Du bassin à la tête | Les mèmes qui se jouent au visage et aux mains : « Mewing », « Chut », « L sur le front », « Regard au loin ». |

Le champ ne sert **que** la vitrine de l'accueil, où le joueur inspecte un mème : la caméra du match est une mise en scène, elle appartient au jeu et ignore ce cadrage.

`body` n'est pas une distance fixe. Le client échantillonne la boucle entière, mesure l'encombrement du squelette (élévation, lévitation et salto compris) et en déduit la distance. Une nouvelle danse qui saute plus haut est donc cadrée correctement sans qu'on touche à une ligne de code — c'est le sens de la règle d'or n°5.

## Accents sonores (`sound`)

Optionnel. Une danse muette ne déclare rien ; une acrobatie, elle, a besoin
qu'on l'entende retomber.

```json
"sound": [{ "at": 0.3, "accent": "whoosh" }, { "at": 0.66, "accent": "impact" }]
```

| Accent | Ce qu'il sonne | Pour quoi |
|---|---|---|
| `whoosh` | un membre qui fend l'air | Roue, Salto arrière, Toupie, Coup de pied lent, Révérence, Épaules époussetées |
| `impact` | un contact sec — une main qui claque, un corps qui retombe | Roue, Salto arrière, Saut applaudi, Applaudissement lent |
| `hold` | le souffle d'une pose tenue | Mains en couronne, Doigt vers le ciel, T-pose, Lévitation, Révérence |

`at` est une **part de boucle** (0 inclus, 1 exclu), pas des secondes :
rallonger une danse de deux dixièmes ne doit pas désynchroniser son impact.
Six accents par animation au maximum.

**Pourquoi ces trois mots-là.** Ils disent ce que le **corps** fait, jamais ce
que le joueur a choisi ni s'il a réussi. C'est ce qui les rend jouables des deux
côtés de l'arène sans rien trahir : un accent ne peut servir que ce qui est
**déjà à l'écran** — une révélation, ou le personnage de la vitrine d'accueil.
Un accent qui transporterait le style ou le palier serait exactement le message
que le protocole refuse d'envoyer avant `round:result` (règle d'or n°4).

**Le nom d'un accent n'est pas validé côté client.** `loadAnimation` vérifie
l'*instant* d'un accent, jamais son vocabulaire : le catalogue se publie sans
mise à jour store, donc une danse peut arriver avec un accent qu'une vieille
version de l'application ne connaît pas. Elle le joue alors en silence plutôt
que de refuser la danse. Le validateur de publication, lui, est strict.

## Autres cosmétiques

| Type | Données |
|---|---|
| Effet d'aura | Paramètres de particules du prototype (type, taux, couleur, taille), niveau d'amplificateur associé |
| Couleur d'aura | Hex |
| Tenue | Couleurs veste/pantalon/chaussures, accessoires (cravate, ceinture, zip) |
| Coiffure | Type de modèle et couleur |
| Emote | Animation courte (≤ 1,5 s) + son |

## Pipeline

1. Écrire ou générer le JSON (skill `/add-dance`).
2. `pnpm --filter @aura/content validate` : schéma, articulations complètes, angles plausibles, longueurs de membres, continuité de la boucle. Les signalements ont deux niveaux — une **erreur** bloque la publication, un **avertissement** est affiché sans bloquer :

   | Contrôle | Seuil | Niveau |
   |---|---|---|
   | Schéma JSON, articulation manquante, champ inconnu | — | erreur |
   | Longueur d'un membre autour de sa médiane | > 25 % | avertissement |
   | Longueur d'un membre autour de sa médiane | > 60 % | erreur |
   | Rotation du corps / salto | > 2π / > 4π | erreur |
   | Déplacement moyen entre deux images clés (bouclage compris) | > 90 cm | erreur |

   **Pourquoi la tolérance de longueur n'est qu'un avertissement.** Mesure faite sur les 26 animations portées du prototype : le salto arrière écarte jusqu'à 47 %, le dab et la danse du bateau environ 34 %. Ce ne sont pas des fautes de saisie — les poses sont dessinées en 2D, et un bras qui pointe vers la caméra se raccourcit à l'écran sans que sa longueur réelle change. Traiter l'écart comme une erreur reviendrait à rejeter le contenu qui sert de référence de qualité. Le seuil dur de 60 % est posé au-dessus du pire cas légitime mesuré. Le plafond de 90 cm par transition l'est de même : l'animation la plus extrême, le salto arrière, atteint 63,5 cm.
3. Aperçu dans la page `apps/mobile` `/dev/animation-viewer` (à créer en M4) : lecture, pause, image par image, caméra orbitale.
4. Ajout au catalogue (prix, rareté, dates de disponibilité).
5. Publication : les fichiers sont servis par le serveur avec un `contentVersion` ; le client met en cache et télécharge le delta.

## Rythme : une danse doit accélérer quelque part

Un mème se reconnaît à son **accent** — le griddy claque, le dab tombe, la
danse du bateau tire puis relâche. Un mouvement qui parcourt sa boucle à
vitesse constante n'est pas une danse, c'est un métronome.

Deux champs le décident, et ils sont dans `loop` :

- `weights` — la part de boucle de chaque image. Des parts égales donnent une
  vitesse presque constante.
- `ease` — un adoucissement en S : la vitesse tombe à zéro sur chaque image clé
  et culmine entre deux. À lui seul, il crée déjà un temps fort.

`apps/mobile/src/animation/rhythm.test.ts` mesure le rapport **pic / moyenne**
de la vitesse du squelette sur une boucle complète, et refuse toute animation
non-système en dessous de **2,2**. Repères mesurés sur ce catalogue :

| Rapport | Ce que ça donne |
|---|---|
| 1,0 | vitesse rigoureusement constante |
| ~1,5 | sinusoïde pure — un Catmull-Rom sur des images de durée égale |
| 2,2 à 6 | un ou plusieurs temps forts par boucle |
| > 9 | un sursaut suivi d'une immobilité : ça se lit comme une saccade |

Le test mesure le **résultat**, pas la présence des champs : une animation peut
trouver son accent par ses parts, par son adoucissement, ou en ajoutant des
images clés.

Repères sur les 12 animations ajoutées après le portage (rapport pic/moyenne) :
« Coup de pied lent » 2,52, « Marche assurée » 2,94, « Épaules qui roulent »
3,05 (3,31 avant sa reprise à huit images), « Roue » 3,96, « Saut applaudi » 3,53, « Doigt vers le ciel » 5,78. Un
mouvement lent n'est pas un mouvement plat : le coup de pied lent passe parce
qu'il **s'arrête** en extension, pas parce qu'il va vite.

Les poses système d'une seule image (`charge`, `land`, `stagger`) en sont
exemptées, et elles seules : leur travail est précisément de ne pas bouger.

## Mouvement secondaire : ce que le client ajoute au JSON

La pose affichée n'est pas exactement la pose écrite. Le client
(`apps/mobile/src/animation/secondary.ts`) ajoute à **toutes** les danses,
sans rien lire d'autre que le document :

- la respiration ;
- un transfert de poids latéral lent (bassin ±1,4 cm, buste à 80 %, pieds
  plantés) ;
- sur les danses `hype`, un rebond des genoux calé sur un nombre entier de
  temps par boucle, de 1,2 cm à 2,8 cm selon la ferveur de la salle ;
- la tête et les mains qui traînent derrière le buste et le coude
  (70 ms de retard, 2,5 cm au plus), et le regard qui rattrape en retard un
  corps qui tourne (0,35 rad au plus).

Ce qui en découle pour l'écriture :

- **N'écrivez pas la respiration ni le rebond de fond** : ils sont déjà là.
  Écrivez le geste — et un rebond seulement s'il fait partie du mème.
- Un corps qui flotte (`float`), saute (`lift`), fait un salto ou dont le
  bassin est sous −55 n'a ni transfert de poids ni rebond : la T-pose, la
  lévitation et la méditation restent immobiles là où elles doivent l'être.
- Aucune articulation ne s'écarte de plus de **3,5 cm** de la pose écrite ; le
  cadrage de la vitrine ajoute cette marge à sa mesure.
- `prefers-reduced-motion` ne garde que la respiration.

## Pièges de rédaction (mesurés en écrivant les 12 dernières danses)

- **Des bras écartés en `z` mais bas se lisent comme une position debout.** Le
  `z` est bien l'axe latéral à l'écran, mais si les mains restent sous la ligne
  d'épaule (`y` du cou, ≈ −132) elles se confondent avec le corps. La première
  version de « Célébration de but » avait les mains à −112 : dans la vitrine,
  le personnage avait l'air immobile. Mains à −150, coudes à −140, `z` à ±50.
- **Une rotation qui reboucle dépasse la verticale à la couture.** Le
  Catmull-Rom déborde, et une danse qui finit à −2π avec une image voisine
  lointaine se retrouve inclinée de 9° en position debout — assez pour enfoncer
  un pied sous le sol. « Roue » a demandé deux temps à l'atterrissage et une
  **posture debout étroite** (pieds à ±10 cm comme le salto arrière, pas ±18).
  `apps/mobile/src/arena/rig.test.ts` (« ne fait jamais passer un personnage
  sous le sol ») mesure le maillage réel, pas les articulations : il voit ce que
  `bounds.ts` ne voit pas.
- **Un mouvement lent n'est pas un mouvement plat.** « Coup de pied lent »
  passe le test de rythme à 2,52 parce qu'il **s'arrête** en extension, pas
  parce qu'il va vite : `ease: true` plus une part de boucle large sur la pose
  tenue.

## Pictogramme (`icon`)

Chaque pose de mouvement porte un **pictogramme** (`"icon"`, un emoji). C'est
l'illustration de sa carte dans la main de choix (chantier n°2).
- Il est **obligatoire** : `loadAnimation` refuse une pose sans pictogramme.
- Il est unique au sein d'une famille : un test le vérifie.
- Il est facultatif pour une animation système.

Choisir un pictogramme qui montre le **geste**, pas la personne qui l'a rendu
célèbre, selon la même règle que pour les noms.

## Poses au sol, à l'envers et en boule (mesuré en écrivant Acrobatie et Prouesse)

Les six poses du 2026-09-24 (Roulade, Biceps contractés, Pompes, Planche,
Poirier, Drapeau humain) ont révélé quatre pièges que le validateur ne voit pas,
mais que le test de garde au sol du rig attrape :

- **Le poignet n'est pas le bout de la main.** La main se prolonge d'environ
  10 à 14 cm dans l'axe de l'avant-bras. Un appui au sol (pompes, poirier) pose
  donc le **poignet** à ~9 cm, jamais à 0. Et `["open","down"]` enfonce les
  doigts dans le sol : préférer le poing (`fist`) ou une paume `fwd`.
- **`pitch` tourne autour d'un pivot fixe à 85 cm**, et `lift` ne peut que
  monter. Une pose couchée ou roulée au ras du sol ne s'obtient donc **pas**
  par `pitch` (elle flotterait) : on la dessine articulation par articulation
  (planche, pompes), ou on fait tourner la pose autour d'un centre bas calculé
  à la main (roulade). `pitch` convient au poirier (π) et au drapeau (π/2), avec
  un `lift` qui ramène les mains au sol.
- **Un quart de tour interpolé en ligne droite traverse le sol.** Une roulade
  qui s'arrête à 270° puis « saute » vers la pose accroupie fait passer le tibia
  sous le plancher. Faire le tour complet (0, 90, 180, 270, 360°).
- **Une tangente non nulle à la couture fait plonger les pieds.** Avant une image
  posée au sol, ajouter une image de maintien ou un petit élan **dans le sens de
  la rotation**, pour que la courbe reste monotone. Sinon le Catmull-Rom repart
  d'abord en arrière.

Un aperçu couché se cadre sur sa **longueur** : `previewFraming` prend le plus
grand de la hauteur et de 1,6 × le rayon au sol, sans quoi la caméra coupe la
tête et les pieds d'une planche de 40 cm de haut.

## Dix variantes plus tard (mesuré en écrivant les variantes du 2026-09-25)

- **Un geste de face s'écrit en `z`.** « Biceps contractés » avait ses coudes
  et ses pieds sur l'axe avant/arrière : de face, les poings croisaient le
  visage et les pieds s'alignaient. Bras écartés, jambes écartées : `z`.
- **Recopier l'image groupée du salto arrière rapporte 7 avertissements** : son
  buste mesure 34 cm au lieu de ~52. Le groupé du « Saut groupé » a les bonnes
  longueurs ; partir de lui.
- **Un pied qui quitte vite le sol plonge juste avant.** Poser le pied sur la
  pointe (y −2) dans l'image d'appui, et lancer le coup de pied plus bas.
- **Mains ouvertes au sol : poignet à 13 cm, pas 9.** La règle des 9 cm ne vaut
  que pour un poing ; les doigts ouverts passaient 5 cm sous le sol.
- **Un tibia incliné enfonce son embout.** Pied à y = 0 et tibia penché de ~30°
  (genoux loin devant) : −4,2 cm. Reculer la hanche (tibia à ~20°) et garder
  un petit écart de `z` entre genou et pied. Squats et squat sur une jambe n'ont
  que ~0,7 cm de marge.
- **Le test de l'épaule attrape un bras très plié** : des mains qui claquent
  collées au cou débordent de 0,9 %. Claquer plus loin de la poitrine.

### Regarder une pose

`http://localhost:5173/?pose=<id>` ouvre la vitrine sur n'importe quelle pose,
en développement seulement. Deux pièges :

- **Un fichier ajouté n'apparaît pas tout seul** : la liste de
  `import.meta.glob` est figée au démarrage de Vite, et le dossier des
  animations vit hors de l'application. Toucher
  `apps/mobile/src/content/animations.ts` la recalcule.
- **Pour figer un instant, avancer l'horloge par pas de 16 ms.** L'arène borne
  le pas de temps d'une image : une horloge qui saute de 400 ms n'avance la danse
  que d'un pas, et un salto semble ne jamais quitter le sol.

## Noms et droits (à vérifier avant publication)

Le prototype utilise des noms de tendances. Avant la sortie sur les stores :

- Éviter les noms de personnes réelles, de chansons, d'artistes et de marques, ainsi que les chorégraphies identifiables d'un créateur.
- À renommer ou valider juridiquement : « Griddy », « Moonwalk », « Six Seven », « Floss », « Dab ».
- Préférer des noms maison (« Pas quadrillé », « Glisse arrière », « Six-Sept »…) et consigner les validations dans `docs/adr/`.
- Ce point relève d'un avis juridique ; ce document n'en tient pas lieu.

**Les 12 animations ajoutées après le portage sont toutes descriptives**, et
c'est une règle de rédaction, pas un hasard : « Célébration de but », « Roue »,
« Marche assurée », « Révérence », « Épaules époussetées » nomment le **geste**,
jamais qui l'a rendu célèbre. Les tendances des plateformes portent souvent le
nom de quelqu'un — inutilisable tel quel. En cas d'hésitation sur un nom, le
descriptif l'emporte : il ne demande aucune validation juridique et il survit à
la tendance qui l'a inspiré.

## Live-ops

- **Feature flags** côté serveur (bulle d'intention, événements, nouvelles règles en test).
- **Événements hebdomadaires :** variantes de règles déclarées en données (ex. « Provoc uniquement », « Énergie 10 »), jouées en partie rapide.
- **Rythme cible au lancement :** 1 nouvelle danse par semaine, 1 passe de saison toutes les 8 semaines.
