# 01 — Game design PvP (fait foi)

Toutes les valeurs de ce document vivent dans `packages/rules/src/balance.ts`. Toute modification de valeur met à jour ce document.

## 1. Vue d'ensemble d'un match

- 2 joueurs, **premier à 2 manches gagnées**, 3 manches maximum.
- Chaque joueur commence avec **14 points d'énergie** pour tout le match.
- Déroulé d'une manche :
  1. **Intro** (2 s)
  2. **Recharge** (6 s, simultanée) : taper des orbes pour gagner un boost d'aura, de la jauge d'Ultime et un peu d'énergie.
  3. **Choix** (15 s max, simultané et secret) : mouvement (style + palier), amplificateur, activation éventuelle de l'Ultime, puis jauge de timing.
  4. **Révélation** (≈ 4,5 s) : révélation des deux auras, résolution des contres, choc, vainqueur de la manche.
- Fin : vainqueur, variation de classement, récompenses.

## 2. Mouvements (gameplay) et animations (cosmétique)

Le score dépend d'un **mouvement** = un **style** et un **palier**. L'**animation** jouée n'est qu'un skin de ce mouvement : toutes les animations d'un même mouvement sont strictement équivalentes.

### Styles et contres

| Style | Icône | Bat |
|---|---|---|
| Calme | 🧊 | Hype |
| Hype | 🔥 | Provoc |
| Provoc | 😏 | Calme |

- Contrer (style qui bat celui de l'adversaire) : **×1,35** sur son score.
- Être contré : **×0,85** sur son score.
- Même style des deux côtés : aucun effet.

### Paliers

| Palier | Puissance | Coût en énergie |
|---|---|---|
| 0 | 11 | 0 |
| 1 | 20 | 1 |
| 2 | 30 | 2 |
| 3 | 42 | 3 |
| 4 | 56 | 4 |

### Animations par défaut (issues du prototype)

| Mouvement | Calme 🧊 | Hype 🔥 | Provoc 😏 |
|---|---|---|---|
| Palier 0 (gratuit) | Bras croisés | Dab | Chut |
| Palier 1 | Main dans la poche | Six Seven | Doigt pointé, T-pose |
| Palier 2 | Regard au loin | Poing levé, Floss | Mewing, Haussement d'épaules |
| Palier 3 | Méditation, Moonwalk | Griddy, Toupie | L sur le front |
| Palier 4 | Lévitation, Salto arrière | Danse du bateau | Dos tourné |

La première animation de chaque case est offerte à tous. Les autres sont des cosmétiques. Voir `07-content-pipeline.md` pour les noms à revoir avant publication.

## 3. Amplificateurs d'aura

| Niveau | Multiplicateur | Coût | Effet visuel par défaut |
|---|---|---|---|
| A0 | ×1,00 | 0 | Lueur |
| A1 | ×1,12 | 1 | Étincelles |
| A2 | ×1,25 | 2 | Éclairs |
| A3 | ×1,40 | 3 | Vortex |
| A4 | ×1,55 | 4 | Galaxie |

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
- Activable à la phase de choix si la jauge est pleine : **×1,5** et **impossible à contrer**. Si l'adversaire avait le style gagnant, son contre est annulé (« Contre bloqué ») et il ne subit pas de malus.
- L'activation vide la jauge.

## 7. Calcul du score d'une manche

```
base  = puissance(palier) × mult(amplificateur) × mult(timing) × (répétition ? 0,7 : 1)
        × (Ultime ? 1,5 : 1) × (1 + boost / 100)
final = base × (contre ? 1,35 : 1) × (contré ? 0,85 : 1)
score = arrondi(final)
```

- **Répétition :** rejouer exactement le même mouvement (style + palier) qu'une manche précédente du match.
- **Pas d'aléatoire dans le score en PvP.** Le hasard ne porte que sur la génération des orbes et de la jauge, identique pour les deux joueurs dans une manche.
- Vainqueur de la manche : score le plus élevé. En cas d'égalité, le plus petit écart de timing gagne. Si l'égalité persiste, manche nulle.

## 8. Fin de match et départage

1. Premier à 2 manches gagnées.
2. Après 3 manches sans vainqueur : plus de manches gagnées, puis plus haut total de scores, puis plus petite somme des écarts de timing, puis match nul.
3. Abandon ou déconnexion définitive : victoire de l'autre joueur.

## 9. Délais et actions par défaut

- Phase de choix sans verrouillage à l'échéance : mouvement palier 0 d'un style tiré par la graine de la manche, A0, sans Ultime, timing « Raté ».
- Deux manches consécutives sans aucune action du joueur : forfait.

## 10. Bulle d'intention (optionnelle, à tester en bêta)

Mécanique inspirée de la bulle de pensée du prototype : pendant la phase de choix, chaque joueur peut afficher publiquement un style (vrai ou bluff). S'il gagne la manche avec le style annoncé : +10 de jauge d'Ultime. Activée par feature flag, désactivée par défaut.

## 11. Méta hors match

- **Classement :** voir `05-matchmaking-ranking.md`.
- **Défis quotidiens** (validés côté serveur) : contres, parfaits, victoires, points de recharge, combos.
- **Monnaie douce** gagnée en jouant, **monnaie premium** achetée ; toutes deux ne servent qu'au cosmétique et au passe de saison.
- **Solo :** entraînement contre les 4 IA du prototype, adaptées aux règles ci-dessus (tableaux d'IA dans `packages/rules/src/ai`).
