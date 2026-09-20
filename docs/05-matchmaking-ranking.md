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

## MMR et ligues

- MMR caché : **Glicko-2** (ou Elo à K variable si plus simple au départ ; décision à consigner en ADR).
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

## Fantômes

Objectif : aucune file vide au lancement, sans faire croire à un faux humain en ligne.

- **Enregistrement :** à la fin de chaque match classé humain contre humain, on stocke pour chaque joueur ses choix, ses timings (écart et qualité), son profil de recharge (points par manche) et son MMR.
- **Rejeu :** le serveur joue un `GhostRecording` de MMR proche et de même `rulesVersion`. Il adapte les choix impossibles (énergie insuffisante) avec la même politique que l'IA solo.
- **Transparence :** `match:found.ghost = true`. Le client affiche discrètement « Adversaire en différé ». Un match contre un fantôme rapporte 50 % des LP habituels.
- Un fantôme ne réagit pas à l'adversaire en direct. C'est acceptable, car les choix sont simultanés.

## Invitations

- `invite:create` renvoie un code de 6 caractères (sans caractères ambigus) et un lien `https://<domaine>/duel/<code>` qui ouvre l'app (universal links iOS, app links Android) ou la page web de téléchargement.
- Le code expire après 10 minutes ou dès que le match démarre.
- Revanche : proposée aux deux joueurs en fin de match d'invitation, crée une nouvelle invitation liée.
