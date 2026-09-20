# Reprise — état du projet au 20 septembre 2026

Document jetable, écrit pour qu'une nouvelle conversation reprenne sans relire
tout l'historique. Il ne remplace pas `docs/08-roadmap.md`, qui reste la source
de vérité sur les jalons.

**Branche :** `chore/m0-monorepo`, poussée, 112 commits, rien en attente.
**Vert :** `pnpm test` 1991 tests (rules 274, protocol 99, content 84, mobile 874,
server 660 + 3 ignorés), `pnpm lint` et `pnpm typecheck` propres.

---

## Ce qui est jouable aujourd'hui

Un duel en ligne complet, à deux navigateurs, sur `pnpm dev` :
file d'attente (classé ou rapide) ou invitation par code/lien → recharge →
choix secret → jauge de timing → révélation en 3D → résultat, LP, ligue,
revanche. Contre un fantôme si personne n'attend. Et un solo hors ligne
contre les quatre profils d'IA.

Le personnage danse sur l'accueil : galerie de 33 mèmes parcourable, essayage
des cosmétiques dans la boutique avant achat.

## Jalons

| | État |
|---|---|
| M0 monorepo | terminé |
| M1 `@aura/rules` | terminé (couverture branches 90,3 %, lignes 98,5 %) |
| M2 `@aura/protocol` + `@aura/content` | terminé — **38 animations** |
| M3 serveur de match | terminé, relu par `security-reviewer` (7 défauts corrigés) |
| M4 client jouable | **presque** — voir « ce qui manque » |
| M5 classé, matchmaking, fantômes | **presque** — classement général manquant |
| M6 application mobile | **non commencé** — Capacitor pas installé |
| M7 charge | première moitié faite (500 matchs, p95 0,50 ms, ADR 0011) |

## Ce qui manque, par ordre d'importance

1. **Capacitor (M6).** Rien n'est installé : ni `capacitor.config.ts`, ni projets
   iOS/Android, ni haptique, ni deep links natifs, ni verrouillage paysage natif
   (l'API web `screen.orientation` fait le travail dans le navigateur).
   *Je peux écrire la configuration et le code ; je ne peux pas compiler
   l'application iOS/Android ni la déposer sur TestFlight.*
2. **Niveaux de qualité graphique automatiques** (foule, doigts, particules,
   pixel ratio) — M6. La mesure de budget d'images existe (`docs/09`), le
   réglage automatique non.
3. **Classement général** (M5) — demande une lecture serveur que le protocole
   ne porte pas encore.
4. **Multi-nœuds et reprise après redémarrage** (deuxième moitié de M7). La
   mesure de charge dit à partir d'où ça devient nécessaire : à 1000 matchs,
   68 % d'un cœur, le retard de boucle explose par rafales.
5. **Anti-triche statistique** (`SuspicionFlag`, sanctions progressives) —
   les contrôles temps réel sont en place, la détection statistique non.
6. **`CosmeticKind.EMOTE`** est encore dans l'enum Prisma alors que les émotes
   ont été retirées — demande une migration.
7. **Page `/dev/animation-viewer`** — la galerie de l'accueil la remplace pour
   l'usage courant, pas pour le débogage image par image.
8. **Particules d'aura** : écrites et testées, mais branchées à rien.
9. **Export de clip** — mis de côté sur ta demande.

## Une relecture de sécurité à ne pas oublier de refaire

Les commits du banc de charge (`76bdd8e`) ont été poussés **avant** la relecture
que `CLAUDE.md` exige pour tout ce qui touche `apps/server/src/modules/match` ou
`packages/protocol`. L'agent qui l'avait demandée s'est arrêté sur une limite de
session sans rien produire. La revue automatique a rattrapé trois défauts, tous
corrigés et poussés dans `faa86d1` :

- une table indexée par **nom d'événement choisi par le client** — 5 000 noms
  inventés créaient 5 000 histogrammes, jusqu'à épuiser la mémoire du nœud ;
- `GET /health/metrics` et `POST /health/metrics/reset` ouvertes à qui sait
  former une requête HTTP.

**Ce qui n'a pas été vérifié**, faute de relecteur : les six points que j'avais
listés, notamment la concurrence (un compteur partagé entre deux sièges) et les
fenêtres de mesure qui s'ouvrent sans se refermer sur un gestionnaire qui lève.
Relancer un `security-reviewer` sur `git diff 167bcc1..HEAD -- apps/server
packages/protocol` est la première chose à faire.

## Pièges appris cette session (les plus coûteux)

- **Une valeur de `packages/rules` réexprimée ailleurs ne se voit ni au
  compilateur, ni aux tests, ni en relecture.** Cinq cas trouvés : les zones de
  la jauge codées en dur dans le CSS pendant que le moteur les tirait de
  `balance.ts` (le joueur visait une bande dorée qui n'existait pas), les
  paliers écrits 0..4, la table des contres dupliquée, l'origine du temps de la
  jauge, le schéma JSON des animations en double.
- **Un test qui dépasse son délai se lit comme un invariant cassé.** Deux fois,
  le journal a annoncé que le moteur n'était plus déterministe alors que la
  machine était simplement occupée par le banc de charge. Délai généreux posé
  sur le *bloc*, jamais sur le seul test qui a lâché.
- **La cascade CSS n'a pas de compilateur.** Un `@media` écrit avant la règle
  qu'il corrige perd silencieusement ; `.rail__btn span` attrapait un libellé
  qu'il n'était pas censé toucher.
- **Beaucoup de défauts ne se trouvent qu'en jouant** : un seul combattant
  visible en ligne, le nom de l'adversaire perdu à la reconnexion, les fantômes
  incapables d'aider les premiers joueurs (table vide), le badge dit deux fois,
  les cibles tactiles sous 46 px.
- **`--force` avant de conclure qu'un agent s'est trompé** : Turbo sert un
  typecheck calculé avant la dernière édition.
- **Un test peut graver une faille au lieu de la prévenir.** Un e2e exigeait
  qu'un nom d'événement inventé par le client ait sa propre entrée dans la
  table de mesure : écrit pour prouver qu'un message refusé est bien compté, il
  verrouillait l'épuisement mémoire. Rien dans sa rédaction ne distinguait les
  deux intentions.

## Où reprendre

Le plus utile maintenant est **M6**, et dedans la partie que je peux terminer
seul : les niveaux de qualité graphique automatiques, puis la configuration
Capacitor complète (haptique, cycle de vie, deep links) prête à compiler dès
que tu lances Xcode ou Android Studio.
