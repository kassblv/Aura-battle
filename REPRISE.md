# Reprise — état du projet au 20 septembre 2026

Document jetable, écrit pour qu'une nouvelle conversation reprenne sans relire
tout l'historique. Il ne remplace pas `docs/08-roadmap.md`, qui reste la source
de vérité sur les jalons.

**Branche :** `chore/m0-monorepo`, poussée, 115 commits, rien en attente.
**Vert :** `pnpm test` 1999 tests (rules 274, protocol 102, content 84, mobile 874,
server 665 + 3 ignorés), `pnpm lint` et `pnpm typecheck` propres.

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

## La relecture de sécurité est faite

Elle a eu lieu (`security-reviewer`, périmètre `git diff 167bcc1..HEAD --
apps/server packages/protocol`) et elle est **close**. Verdict : rien de
bloquant dans le diff — pas de fuite d'information, aucune valeur calculée par
le client qui soit crue, aucun compteur anti-triche partagé entre sièges.

Quatre défauts trouvés, tous corrigés et couverts par des tests de mutation :

| | Défaut | Commit |
|---|---|---|
| A | Un paquet atteignait un gestionnaire **avant la fin de l'authentification** — sans identité, sans limite de débit, sans schéma. Latent aujourd'hui (l'authentification ne fait aucune E/S), ouvert dès que quelqu'un y ajoutera une lecture Redis ou base. | `7d9f5f4` |
| B | Table d'histogrammes indexée par un nom d'événement **choisi par le client** : 5 000 noms inventés, 5 000 histogrammes. | `faa86d1` |
| C | Le message d'erreur d'analyse recopiait les noms de clés inconnues : **148 918 caractères** pour 5 000 clés, sans autre limite que le mégaoctet d'engine.io. | `4dec605` |
| D | Deux messages de même nom en vol échangent leurs durées de mesure. Documenté plutôt que corrigé — corriger demanderait un identifiant par paquet que Socket.IO ne fournit pas. | `4dec605` |

Les quatre sont **le même défaut sous quatre formes** : une structure dont le
client choisit la taille. La phrase de `CLAUDE.md` — *le protocole borne un
message, pas la somme des messages* — était écrite et n'en a empêché aucun.

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
- **Un test vert ne dit rien tant qu'on ne l'a pas vu rouge pour la bonne
  raison.** Trois fois de suite : un test du nom d'événement numérique qui
  passait à vide (`socket.io-client` ne sait pas émettre un nom numérique, il
  fallait une socket brute) ; une mutation qui semblait innocenter une garde
  alors que c'était un *plantage* qui bloquait le paquet ; et un test de borne
  qui aurait aussi passé avec une coupe proportionnelle, donc sans borne. La
  parade : muter la **structure**, et vérifier qu'une borne ne bouge pas quand
  la charge est multipliée par dix.
- **Un commentaire qui affirme faux empêche la relecture.** `handleConnection`
  portait « c'est la seule attente de cette méthode » alors que
  l'authentification en était une autre, avant. C'est cette phrase qui rendait
  le défaut [A] invisible à la lecture.

## Où reprendre

Le plus utile maintenant est **M6**, et dedans la partie que je peux terminer
seul : les niveaux de qualité graphique automatiques, puis la configuration
Capacitor complète (haptique, cycle de vie, deep links) prête à compiler dès
que tu lances Xcode ou Android Studio.
