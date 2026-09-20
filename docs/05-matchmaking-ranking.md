# 05 — Matchmaking, classement et fantômes

## Modes

| Mode | Classement | Adversaire |
|---|---|---|
| Classé | Oui | Humain de MMR proche, fantôme en dernier recours |
| Partie rapide | Non (MMR caché séparé) | Humain, fantôme plus tôt |
| Invitation | Non | Ami via code ou lien |
| Solo | Non | IA du prototype |

## File d'attente

- Ticket en Redis : `playerId`, MMR, heure d'entrée, région.
- Toutes les 500 ms, un worker apparie les tickets par ordre d'ancienneté.
- Fenêtre MMR : ±50 au départ, +25 par seconde d'attente, plafonnée à ±400.
- Éviter de rematcher le même adversaire deux fois de suite dans les 10 minutes quand c'est possible.
- Classé : fantôme après **25 s**. Partie rapide : fantôme après **12 s**.

### Précisions d'implémentation (jalon M5, ADR 0009)

Ces points ne changent aucune valeur ci-dessus ; ils tranchent ce que la liste laissait ouvert.

- **La fenêtre s'élargit par secondes entières** (±50, ±75, ±100…). `queue:status.searchRange`
  transporte un entier, et un palier visible vaut mieux qu'un nombre qui tremble à chaque tour.
- **Les deux fenêtres doivent accepter l'écart.** Un joueur qui attend depuis dix secondes
  n'impose pas son ±300 à quelqu'un qui vient d'entrer : le second hériterait d'un adversaire
  qu'il n'a jamais accepté de chercher.
- **Parmi les candidats acceptables, le MMR le plus proche gagne**, puis l'ancienneté. La
  fenêtre autorise un écart, elle ne le recherche pas.
- **Les adversaires récents sont lus à l'entrée en file** et transportés dans le ticket : la
  liste d'un joueur ne peut changer qu'en finissant un match, or on ne finit pas de match en
  faisant la queue.
- **MMR de départ : 1000**, celui de `Rating.mmr` (docs/04), pour un joueur sans classement —
  et aussi quand la base est illisible : une panne de classement ne doit pas empêcher de jouer.
- **Une seule région (`global`)** tant que ni le modèle de données ni le protocole n'en portent.
  L'appariement ne marie déjà que des tickets de même région.
- **Un ticket par joueur, toujours.** Renvoyer `queue:join` dans le même mode ne crée pas de
  second ticket et ne remet pas l'attente à zéro ; changer de mode est une autre recherche.
- **`queue:status` ne porte que ce qui appartient au destinataire** : son mode, son attente, sa
  fenêtre. Ni MMR, ni taille de la file, ni position dedans.
- **Perdre sa socket n'est pas quitter la file.** Le ticket sort de la file — on n'apparie
  jamais un absent — mais il est *garé* pendant **45 s**, la même grâce que pour un match en
  cours (`docs/03`), qui demande d'ailleurs au client de fermer sa socket quand l'application
  passe en arrière-plan. À la reconnexion, le serveur remet le ticket en jeu avec son
  ancienneté et renvoie un `queue:status` : le joueur n'a rien à redemander. Au-delà des 45 s,
  le ticket est oublié. Quitter volontairement la file, en revanche, est définitif.
- **Une paire appariée mais dont le match ne s'ouvre pas retourne en file**, ancienneté
  intacte. Le tour d'appariement retire les deux tickets *avant* de tenter l'ouverture ; sans
  ce retour, un refus tardif — un siège pris entre-temps par une invitation — laisserait les
  deux joueurs hors de la file et sans match, devant un écran de recherche que plus rien
  n'alimente. Celui qui vient de s'asseoir ailleurs n'y retourne pas, lui — ni celui qui a
  envoyé `queue:leave` entre-temps : son ticket était déjà réclamé, donc l'annulation n'avait
  rien à retirer, et le remettre en file le rendrait appariable alors que son client a quitté
  l'écran de recherche. Il encaisserait le `match:found` suivant sans le jouer, c'est-à-dire
  une défaite classée sur une recherche annulée. L'annulation reste donc opposable pendant une
  minute, et un nouveau `queue:join` l'efface. Le **tour d'appariement** la consulte lui aussi :
  l'annulation est inscrite tout de suite, mais le retrait du ticket part derrière l'écriture en
  cours — un tour qui tombe dans cet intervalle apparierait un joueur qui vient de renoncer. Celui qui s'est **déconnecté** pendant ce
  temps-là, lui, voit son ticket garé comme n'importe quelle déconnexion : ni en file, ni
  perdu.
- **« Déconnecté » et « déjà en duel » ne se répondent pas par le même booléen.** Le premier
  garde sa place le temps de revenir, le second la perd — son ticket n'a plus d'objet. Partout
  où le serveur écarte un joueur de la file (tour d'appariement, retour en file), les deux
  questions sont posées séparément ; les confondre revient à détruire la place de quelqu'un
  qui revient, ou à remettre en recherche quelqu'un qui est en train de jouer.

## MMR et ligues

- MMR caché : **Elo à K variable** (décision consignée dans l'ADR 0010 : Glicko-2 suppose des
  périodes de classement groupant plusieurs matchs, incompatible avec un règlement immédiat, un
  match à la fois).
- Ligues visibles avec points de ligue (LP), reprenant les rangs du prototype :

| Ligue | LP |
|---|---|
| Sans aura | 0–99 |
| Aura naissante | 100–399 |
| Aura stable | 400–999 |
| Aura rayonnante | 1 000–2 499 |
| Aura légendaire | 2 500–5 999 |
| Aura infinie | 6 000+ |

- LP gagnés/perdus : base ±20, corrigée par l'écart entre MMR et LP pour converger (gain plus fort si le MMR est au-dessus des LP).
- 5 matchs de placement par saison.
- Saison de 8 semaines ; réinitialisation douce en fin de saison (LP ramenés vers la médiane, MMR compressé de 20 % vers 1 000).

### Précisions d'implémentation (jalon M5, ADR 0010)

Ces points ne changent aucune valeur ci-dessus ; ils tranchent ce que la liste laissait ouvert.

- **K vaut 60 durant les cinq matchs de placement de la saison**, puis 24 ensuite — le rôle
  qu'une déviation élevée jouerait sous Glicko-2, sans en modéliser une explicitement.
- **La correction MMR/LP se lit sur le MMR d'avant le match**, jamais celui d'après : sinon le
  résultat du match amplifierait sa propre correction. Elle est plafonnée à ±10 — strictement
  sous la base ±20 — pour qu'un vainqueur ne reparte **jamais** avec un delta nul ou négatif, ni
  un perdant avec un delta nul ou positif.
- **Un forfait compte comme une défaite** pour le MMR et les LP : sans cela, abandonner ne
  coûterait rien de plus qu'un écran fermé plus tôt. **Un double abandon** (les deux sièges
  inactifs deux manches de suite) **ne change le classement de personne** : ni l'un ni l'autre
  n'a joué la manche qui termine le match.
- **Récompenses de fin de match** (`softCurrency`, `xp` — cosmétique uniquement, ADR 0003 ; le
  MMR/LP ne s'achète jamais) :

  | Issue | Monnaie douce | XP |
  |---|---|---|
  | Victoire | 20 | 30 |
  | Nul (départage complet) | 12 | 18 |
  | Défaite jouée jusqu'au bout | 8 | 12 |
  | Abandon (forfait) | **0** | **0** |

  L'abandon rapporte strictement moins qu'une défaite jouée, et rien du tout : sans ce plancher
  à zéro, la boucle « rejoindre la file, abandonner, recommencer » serait plus rentable que
  jouer, sans jamais risquer une défaite prolongée.
- **Seuls les matchs classés (`RANKED`) écrivent un classement.** Une partie rapide ou une
  invitation affiche le classement classé existant du joueur (avant = après, rien ne change) ;
  aucune des deux ne le modifie. Les récompenses, elles, s'appliquent à tout match joué entre
  deux humains — seul l'abandon les annule, quel que soit le mode.
- **Les six ligues sont transmises comme des identifiants stables** (`sans_aura`, `naissante`,
  `stable`, `rayonnante`, `legendaire`, `infinie`), pas comme des libellés français : le client
  les traduit par ses propres clés i18n (CLAUDE.md, règle des langues). `match:end.rating`
  porte les **LP**, jamais le MMR — qui reste caché même du joueur concerné.
- **`match:found.league` lit une ligue mise en cache à la connexion**, comme le nom affiché
  (docs/03), et rafraîchie à chaque match classé — sans quoi elle resterait figée à sa valeur
  d'entrée en session pendant vingt manches classées.
- **Hors périmètre de ce jalon** : la réinitialisation douce de fin de saison (dernière ligne
  ci-dessus) et le MMR caché séparé de la partie rapide ne sont pas encore codés.

## Fantômes

Objectif : aucune file vide au lancement, sans faire croire à un faux humain en ligne.

- **Enregistrement :** à la fin de chaque match classé humain contre humain, on stocke pour chaque joueur ses choix, ses timings (écart et qualité), son profil de recharge (points par manche) et son MMR.
- **Rejeu :** le serveur joue un `GhostRecording` de MMR proche et de même `rulesVersion`. Il adapte les choix impossibles (énergie insuffisante) avec la même politique que l'IA solo.
- **Transparence :** `match:found.ghost = true`. Le client affiche discrètement « Adversaire en différé ». Un match contre un fantôme rapporte 50 % des LP habituels.
- Un fantôme ne réagit pas à l'adversaire en direct. C'est acceptable, car les choix sont simultanés.

### Précisions d'implémentation (jalon M5)

Ces points ne changent aucune valeur ci-dessus ; ils tranchent ce que la liste laissait ouvert.

- **Le vivier doit être amorcé.** Un enregistrement ne naît que d'un match classé entre humains :
  le jour du lancement il n'y en a aucun, donc la fonctionnalité qui existe pour empêcher une file
  vide ne marche pas quand la file est vide. Le seed pose donc une **réserve de départ** produite
  hors ligne en faisant jouer les quatre profils de l'IA solo par le vrai moteur
  (`domain/ghost-seeding.ts`) : 13 niveaux de MMR de 200 à 2600, par pas de 200, trois
  enregistrements chacun. Le pas est dicté par la fenêtre de recherche — ±350 au premier instant de
  bascule en partie rapide, ±400 en classé — et garantit un adversaire dès la première tentative
  pour tout joueur entre −150 et 2950 de MMR.
- **La règle d'enregistrement ne change pas** : un rejeu ne sert jamais de modèle, sinon le niveau
  de la file dériverait de copie en copie.
- **Le profil joué suit le MMR annoncé** (débutant sous 800, mystérieux jusqu'à 1200, calme jusqu'à
  1800, intouchable au-delà). Un enregistrement de débutant portant un MMR élevé serait une victoire
  offerte, et fausserait le classement de qui le croise.
- **Les enregistrements amorcés sont reconnaissables** au préfixe `seed:` de leur `playerId` — qui ne
  porte aucune clé étrangère (docs/04) et ne peut donc pas entrer en collision avec un joueur réel.
  On les retrouve tels quels dans `MatchSeat.ghostOfId`.
- **Ils ne sont jamais supprimés, et jamais préférés.** `selectGhost` place un enregistrement humain
  avant un enregistrement amorcé : celui-ci n'est joué que si aucun humain ne convient, ce qui le
  retire de fait dès que le vivier réel se remplit. Les supprimer rouvrirait le trou le jour d'un
  changement de `rulesVersion`, où tous les enregistrements existants deviennent inéligibles d'un
  coup — le seed est à rejouer à ce moment-là, et il est idempotent pour cela.
- **À égalité parfaite, l'horloge tranche** entre les candidats. Sans cela la sélection, déterministe,
  rendrait le même enregistrement à chaque recherche, et un joueur seul rejouerait les mêmes manches
  en boucle.

## Invitations

- `invite:create` renvoie un code de 6 caractères (sans caractères ambigus) et un lien `https://<domaine>/duel/<code>` qui ouvre l'app (universal links iOS, app links Android) ou la page web de téléchargement.
- Le code expire après 10 minutes ou dès que le match démarre.
- Revanche : proposée aux deux joueurs en fin de match d'invitation, crée une nouvelle invitation liée.
