# ADR 0009 — File d'attente dans Redis, décision d'appariement pure

- Statut : accepté
- Date : 2026-09-20

## Contexte

`docs/05` décrit une file d'attente : un ticket Redis par joueur, un worker qui apparie
toutes les 500 ms par ordre d'ancienneté, une fenêtre MMR qui s'élargit. Le protocole
déclarait déjà `queue:join`, `queue:leave` et `queue:status`, mais le serveur n'en traitait
aucun : seul le code d'invitation permettait de jouer. Un joueur seul devant son téléphone
ne pouvait pas jouer.

Trois questions se posaient.

**Où vit la file ?** Elle doit survivre au redémarrage d'un serveur et, à terme, se partager
entre instances. Une `Map` de processus ne fait ni l'un ni l'autre.

**Où vit la décision ?** « Qui joue contre qui, avec quelle fenêtre, à quel instant » est de
la logique pure, et c'est la partie qu'on voudra éprouver par milliers de cas.

**Comment un appariement ouvre-t-il un match ?** L'invitation le faisait déjà, dans la
passerelle. Deux chemins d'ouverture séparés divergent toujours : l'un finit par annoncer le
bon nom d'adversaire et pas l'autre, l'un vérifie que les sièges sont libres et pas l'autre.

## Décision

**La file est dans Redis, derrière deux ports.** `QueueTicketStore` range les tickets,
`RecentOpponentStore` retient les rencontres. L'adaptateur utilise un ensemble trié pour
l'ordre d'ancienneté, une clé par ticket avec durée de vie, et un script Lua pour retirer
**les deux** tickets d'une paire ou aucun. Un double en mémoire réalise les mêmes ports et
passe la **même suite de tests de contrat** que l'adaptateur Redis.

**Le client est `redis` (node-redis) 6.2.1**, pas `ioredis` : le README d'ioredis recommande
lui-même node-redis pour un nouveau projet et annonce une maintenance « au mieux ».

**La décision d'appariement est pure** (`matchmaking/domain/pairing.ts`) : elle reçoit les
tickets et un instant, elle rend des paires. Le temps est un paramètre, jamais un
`Date.now()` caché — vérifier l'élargissement de la fenêtre ne demande donc pas d'attendre
quinze secondes.

**Un seul chemin d'ouverture** (`match/application/match-opener.ts`), emprunté par
l'invitation comme par la file. Il refuse d'asseoir un joueur en face de lui-même, vérifie
que les deux sièges sont libres, annonce `match:found` à chacun avec le nom de
l'**adversaire** — nom résolu à la connexion, pas ici — ouvre le match, puis sort les deux
joueurs de la file. **Aucune attente nulle part** : un `await` entre le contrôle des sièges
et leur réservation suffit à asseoir un joueur à deux matchs.

**Le retour en file appartient à l'appelant, pas à l'ouverture.** Quand `open` rend `null`,
les deux tickets ont déjà quitté la file : c'est le tour d'appariement qui les a réclamés, et
lui seul les a encore en main — avec leur ancienneté, qui est conservée. L'ouverture, elle,
ne peut rien y reposer : elle n'a jamais eu les tickets, et elle n'a pas le droit d'attendre.

**Les écritures de la file sont sérialisées par joueur.** Deux chemins qui touchent le même
ticket peuvent s'entrelacer à chaque `await`, et ce n'est pas théorique : au retour
d'arrière-plan, la reconnexion et le `queue:join` du client partent ensemble, chacun lit une
file où l'autre n'a pas fini d'écrire, et le joueur perd l'ancienneté qu'on venait de lui
préserver. Une chaîne de promesses par joueur — pas un verrou global, deux joueurs différents
n'ont aucune raison de s'attendre — rend l'ordre déterministe sans rien demander au rangement.

**Le câblage NestJS de la file vit dans `MatchModule`**, pas dans un module à part. La
passerelle doit traiter `queue:join` — il n'y a qu'une socket authentifiée, donc qu'une
passerelle — et le worker doit ouvrir des matchs : deux modules Nest se seraient importés
l'un l'autre. Le **code**, lui, reste séparé : `modules/matchmaking/` ne connaît rien du
module match, il ne voit que ses ports.

## Conséquences

- L'appariement se teste sans Redis, sans socket et sans attendre : les tests de `pairing`
  couvrent l'élargissement, l'ordre d'ancienneté et la conservation des tickets en
  propriétés (fast-check).
- L'adaptateur Redis est éprouvé contre une vraie instance (`*.integration.test.ts`), et la
  suite se saute proprement si elle est injoignable.
- Le multi-instances n'est pas acquis pour autant : la **présence** est encore un registre
  de sockets local au processus. Un serveur ne peut donc notifier que ses propres joueurs, et
  **chaque ticket porte l'instance qui l'a écrit** ; un worker ignore les tickets des autres.
  Sans ce marquage, deux serveurs branchés sur le même Redis se détruisent mutuellement leurs
  files : chacun voit les joueurs de l'autre comme déconnectés et retire leurs tickets. Ce
  n'est pas une hypothèse — c'est ce qui s'est produit dès qu'un second `pnpm dev` a tourné
  sur la même machine pendant le développement de ce jalon. Apparier **à travers** les
  instances demandera l'adaptateur Socket.IO Redis et une présence partagée ; la file, elle,
  est déjà prête.
- Une réserve, tant que le multi-instances n'est pas fait : `remove` supprime le ticket d'un
  joueur **sans regarder l'instance**. C'est ce qu'on veut avec un seul serveur — la
  déconnexion doit toujours nettoyer — mais avec plusieurs, un joueur qui se reconnecte
  ailleurs très vite verrait son nouveau ticket effacé par la déconnexion de l'ancien. Le
  worker de sa nouvelle instance ne le rattraperait pas : il faudra un `remove` conditionné à
  l'instance (script Lua) le jour où plusieurs serveurs tourneront pour de vrai.
- Redis devient une dépendance de démarrage : `RedisService` ouvre la connexion au boot et
  échoue bruyamment si l'instance est absente. Un serveur qui démarrerait quand même
  accepterait des `queue:join` qu'il ne pourrait jamais honorer.
- Les tickets garés le temps d'une reconnexion vivent **en mémoire de processus**, comme la
  présence. C'est cohérent : un ticket appartient déjà à l'instance qui l'a écrit, seule
  capable de joindre son joueur. Un joueur qui se reconnecterait sur une *autre* instance ne
  retrouverait donc pas sa place — même limite, et même remède, que pour la présence.
- Détacher la file dans son propre module Nest restera mécanique le jour où la passerelle
  sera extraite dans un module de transport.
