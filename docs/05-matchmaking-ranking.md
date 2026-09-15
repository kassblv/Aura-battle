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
