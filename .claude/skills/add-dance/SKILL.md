---
name: add-dance
description: Crée une nouvelle danse ou pose cosmétique en JSON pour un mouvement (style + palier), la valide et la rend visible dans le viewer d'animation.
---

# Ajouter une danse

Entrée attendue : nom, style (`calme`, `hype`, `provoc`), palier (0–4), description du mouvement ou référence visuelle, durée approximative.

1. Vérifie dans `docs/07-content-pipeline.md` (« Noms et droits ») que le nom est publiable. Sinon, propose 3 noms maison.
2. Lis 2 animations existantes du même style dans `packages/content/animations/` pour reprendre les proportions du squelette.
3. Décompose le mouvement en 2 à 6 images clés. Pour une boucle rythmée, 2 images en miroir suffisent ; pour un geste avec arrêt, utilise `ease: true` et des `weights`.
4. Respecte les longueurs de membres (bras ≈ 26 + 24, jambe ≈ 40 + 40, buste ≈ 52 unités) à ±25 %.
5. Profondeur : utilise `z` pour les gestes latéraux (bras écartés, floss). Rotation du corps : `rot`. Regard : `hy`. Saut : `lift` (≤ 0). Salto : `pitch` (angles successifs espacés de moins de π).
6. Choisis les formes de mains et l'expression.
7. Écris `packages/content/animations/<style>/anim.<style>.t<palier>.<slug>.json`.
8. Lance `pnpm --filter @aura/content validate` et corrige.
9. Ajoute l'entrée au catalogue avec rareté et prix proposés (cosmétique uniquement).
10. Indique comment la prévisualiser dans `/dev/animation-viewer`.

Rappel : une danse ne change jamais la puissance d'un mouvement.
