# Bulle d'intention en test A/B — chantier n°9 (M10)

Date : 2026-09-26 · Statut : décidé sur recommandation (« continue jusqu'au
bout ») ; relisible.

## Pourquoi

Le prototype faisait lire une bulle au-dessus de l'adversaire : c'est le cœur
du bluff (« il annonce Calme… ment-il ? »). `docs/01` §10 la prévoit
« optionnelle, à tester en bêta, activée par feature flag ». Les indicateurs
produit (chantier n°8) permettent maintenant de **mesurer** si elle rend le jeu
plus prenant, au lieu de le supposer.

## La mécanique (docs/01 §10)

- Pendant la phase de choix, avant son propre verrouillage, un joueur peut
  **annoncer une famille**, vraie ou bluff. **Une seule annonce par manche** :
  la première fait foi (sinon annoncer les cinq garantirait le bonus).
- L'annonce est **publique aussitôt** (`intent:shown` à l'adversaire) : c'est
  son but. Elle ne révèle rien que le joueur n'ait choisi de dire.
- Si le joueur **gagne la manche avec la famille annoncée** : **+10 de jauge
  d'Ultime** (`BALANCE.intent.ultimateBonus`, plafonné comme le reste).
- Moteur pur : `config.intent.enabled` (faux par défaut dans `BALANCE`) ; le
  serveur passe une config où elle est vraie pour les matchs exposés. Un
  événement `INTENT_SHOWN` refusé en silence hors de ces conditions.

## Interrupteurs (feature flags)

- Module serveur `flags`. Les drapeaux sont **déclarés en code** (nom, part
  exposée par défaut) ; une variable d'environnement règle la part sans
  redéploiement de code (`FLAG_INTENT_BUBBLE_ROLLOUT=0..100`). `0` coupe tout.
- **Affectation stable par joueur** : `sha256(drapeau:joueur) mod 100 <
  part`. Même joueur, même groupe, toujours — sans rien stocker pour décider.
- L'affectation est **inscrite** la première fois qu'elle sert
  (`FlagAssignment`), pour que les indicateurs puissent comparer les groupes
  en SQL.

## Exposition au test

- **Partie rapide et invitation seulement.** Le classé reste la référence.
- Bulle active dans un match **si et seulement si tous les sièges réels sont
  dans le groupe exposé.** Un joueur témoin ne voit donc jamais la bulle : le
  groupe témoin reste propre, au prix d'une exposition partielle du groupe
  traité (environ un match sur deux à 50 %).
- Un fantôme ne compte pas pour l'affectation et **n'annonce jamais** (ses
  manches enregistrées n'en portent pas) ; le joueur, lui, peut annoncer.
- `Match.intentBubble` inscrit en base : on sait quels matchs l'avaient.
- Part par défaut : **50 %**.

## Protocole (2.6.0)

- `match:found.intentBubble?: true` et `match:state.intentBubble?: true`.
- `match:state.intents?` : les annonces de la manche en cours (les deux sièges,
  publiques par nature), pour qu'une reprise ne les perde pas.
- `round:result.sides.*.intentKept?: boolean` : la bulle tenue, pour la mise en
  scène du bonus.
- `intent:show` / `intent:shown` existent déjà (docs/03).

## Lecture du test

- `GET /admin/experiments` (même garde que `/admin/indicators`) : par drapeau et
  par groupe — joueurs affectés, rétention J1 et J7, matchs PvP par actif et par
  jour, taux d'abandon — avec effectifs. Mêmes définitions que les indicateurs
  (spec n°8), restreintes aux joueurs du groupe.
- Une section « Expériences » du panneau.

## Mobile

- Dans la main de cartes, en phase de choix : un geste « Annoncer » qui propose
  les cinq familles (pictogrammes), une fois par manche, tant que le joueur n'a
  pas verrouillé. Cible tactile ≥ 46 px, rien ne défile.
- Une bulle au-dessus de l'adversaire quand il annonce (pictogramme de la
  famille), et la sienne au-dessus de soi.
- À la révélation, « Bulle tenue · +10 » quand le bonus tombe.
- Rien de tout cela si `intentBubble` est absent.

## Hors périmètre (itération suivante)

- **Solo** : l'IA qui annonce et bluffe (l'`honest` du prototype). Le solo ne
  connaît pas le groupe du joueur ; à faire si le test est concluant.

## Critères d'acceptation

- [ ] Moteur : annonce hors phase, après verrouillage, deuxième annonce, bulle
  désactivée → refusées ; bonus seulement en gagnant avec la famille annoncée ;
  plafond respecté (tests).
- [ ] Affectation stable et part respectée (test sur 10 000 identifiants) ;
  part 0 → personne.
- [ ] Classé jamais exposé ; match exposé seulement si tous les sièges réels le
  sont ; fantôme jamais annonceur (tests).
- [ ] `intent:shown` n'est envoyé qu'à l'adversaire du match, jamais avant
  l'annonce ; reprise avec `match:state.intents` (tests e2e).
- [ ] Écran vérifié : annonce, bulle adverse, bonus à la révélation ; lint,
  typecheck, tests ; relecture de sécurité et relecture finale.
