# Animations 3D et variantes — chantier n°4

Date : 2026-09-25 · Statut : décidé sur recommandation (« je te fais confiance
sur les recommandations », « continue jusqu'au bout ») ; relisible après coup.

## Pourquoi

- **Acrobatie et Prouesse n'ont rien à débloquer.** Une pose par case, cinq par
  famille, contre huit à onze ailleurs. Deux familles sur cinq n'offrent rien à
  farmer ni à acheter : la boucle « jouer → gagner des pièces → débloquer »
  s'y arrête net.
- **« Biceps contractés » ne se lisait pas.** Coudes et pieds étaient écrits sur
  l'axe avant/arrière, sans `z` : de face, les poings croisaient le visage.
- **Rien ne permettait de regarder une pose** sans la posséder : on écrivait les
  animations à l'aveugle, en ne se fiant qu'aux tests.

## Ce qu'on ajoute

1. **Une visionneuse de développement** : `?pose=<id>` ouvre la vitrine de
   l'accueil sur n'importe quelle pose, en développement seulement.
2. **Le double biceps corrigé** : bras et pieds écartés sur l'axe latéral.
3. **Dix variantes**, une par case d'Acrobatie et de Prouesse. Ce sont des
   cosmétiques de la même puissance que l'offerte de leur case (règle d'or n°3,
   ADR 0014). Leur prix vient de leur rareté.

| Case | Variante | Pictogramme | Rareté | Le geste |
|---|---|---|---|---|
| Acrobatie 0 | Saut étoile | ⭐ | common | saut, bras et jambes écartés en X (latéral) |
| Acrobatie 1 | Saut groupé | 🦘 | common | saut, genoux ramenés à la poitrine |
| Acrobatie 2 | Grand écart sauté | ✂️ | rare | bond, jambes en grand écart avant/arrière en l'air |
| Acrobatie 3 | Vrille | 🌬️ | rare | saut avec un tour complet sur soi, bras serrés |
| Acrobatie 4 | Salto avant | 🎢 | epic | salto vers l'avant, réception accroupie |
| Prouesse 0 | Squats | 🦵 | common | flexions complètes, bras tendus devant |
| Prouesse 1 | Pompes claquées | 👏 | common | pompe explosive, les mains claquent en l'air |
| Prouesse 2 | Chaise invisible | 🪑 | rare | cuisses à l'horizontale, dos droit, bras croisés, tenue |
| Prouesse 3 | Squat sur une jambe | 🦩 | rare | descente sur une jambe, l'autre tendue devant |
| Prouesse 4 | Équerre | 📐 | epic | assis sur les mains, jambes tendues à l'horizontale, corps décollé |

## Hors périmètre

- **La caméra de révélation** existe déjà : zoom ×1,16 sur chaque combattant à
  son instant, et gros plan ×1,12 sur le vainqueur (`arena/events.ts`).
- **La relecture de toutes les poses existantes** : le scan du catalogue a
  relevé les poses sans axe latéral. Celles qui comptent (le Dab) se lisent
  bien de trois quarts, qui est l'angle du match.

## Critères d'acceptation

- [x] Les dix fichiers passent le validateur, le test de garde au sol du rig, le
  test de rythme (pic/moyenne ≥ 2,2) et l'unicité des pictogrammes.
- [x] Chaque variante est achetable (`allCosmetics`) et jouable en duel (mains
  de cartes : badge « +1 » dans les deux familles).
- [x] Contrôle visuel dans la visionneuse : six sur dix vus à l'écran (Saut étoile,
  Grand écart sauté, Salto avant, Pompes claquées, Chaise invisible, Équerre) ;
  Saut groupé, Vrille, Squats et Squat sur une jambe ne sont passés que par les tests.
- [x] lint, typecheck et tests verts.
- [ ] Relecture finale.
