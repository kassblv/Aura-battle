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
- Expressions : `neutral, smug, sad, angry, hurt`.

### Cadrage de prévisualisation (`framing`)

Optionnel, `{ "shot": "body" }` par défaut.

| Valeur | Ce que la caméra montre | Pour quoi |
|---|---|---|
| `body` | Toute la silhouette, distance ajustée à l'encombrement réel de l'animation | Défaut. Le salto arrière, la lévitation et la T-pose sont cadrés plus large sans rien déclarer. |
| `bust` | Du bassin à la tête | Les mèmes qui se jouent au visage et aux mains : « Mewing », « Chut », « L sur le front », « Regard au loin ». |

Le champ ne sert **que** la vitrine de l'accueil, où le joueur inspecte un mème : la caméra du match est une mise en scène, elle appartient au jeu et ignore ce cadrage.

`body` n'est pas une distance fixe. Le client échantillonne la boucle entière, mesure l'encombrement du squelette (élévation, lévitation et salto compris) et en déduit la distance. Une nouvelle danse qui saute plus haut est donc cadrée correctement sans qu'on touche à une ligne de code — c'est le sens de la règle d'or n°5.

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

Les poses système d'une seule image (`charge`, `land`, `stagger`) en sont
exemptées, et elles seules : leur travail est précisément de ne pas bouger.

## Noms et droits (à vérifier avant publication)

Le prototype utilise des noms de tendances. Avant la sortie sur les stores :

- Éviter les noms de personnes réelles, de chansons, d'artistes et de marques, ainsi que les chorégraphies identifiables d'un créateur.
- À renommer ou valider juridiquement : « Griddy », « Moonwalk », « Six Seven », « Floss », « Dab ».
- Préférer des noms maison (« Pas quadrillé », « Glisse arrière », « Six-Sept »…) et consigner les validations dans `docs/adr/`.
- Ce point relève d'un avis juridique ; ce document n'en tient pas lieu.

## Live-ops

- **Feature flags** côté serveur (bulle d'intention, événements, nouvelles règles en test).
- **Événements hebdomadaires :** variantes de règles déclarées en données (ex. « Provoc uniquement », « Énergie 10 »), jouées en partie rapide.
- **Rythme cible au lancement :** 1 nouvelle danse par semaine, 1 passe de saison toutes les 8 semaines.
