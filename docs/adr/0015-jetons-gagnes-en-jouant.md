# 0015 — Les jetons se gagnent en jouant, et le joueur choisit sa monnaie

Date : 2026-09-25 · Statut : accepté (décidé sur recommandation, relisible).

## Contexte

La monnaie dure (`hardCurrency`, les « jetons ») existait en base et dans le
protocole, mais rien ne la créditait. Aucun article n'avait de prix en jetons,
et le serveur ne prélevait des jetons qu'en repli, quand les pièces
manquaient : le joueur ne choisissait jamais.

L'ADR 0014 promet que « l'argent ne fait que raccourcir l'attente ». Une
monnaie qu'on ne peut obtenir qu'en payant n'y satisfait que si tout ce
qu'elle achète s'obtient aussi en jouant, ce qui est le cas ; mais un joueur
qui ne voit jamais un jeton ne comprend pas à quoi ils servent.

## Décision

- **Dix jetons par niveau franchi** (`BALANCE.progression.tokensPerLevel`,
  `levelUpTokens`). Le niveau 2 arrive vers le cinquième match : ses dix jetons
  paient une pose commune (9 💎) dès la première session.
- **Un prix en jetons pour chaque article payant** : dix pièces pour un jeton,
  arrondi au-dessus (`tokenPrice`, `catalogueTokenPrice`). Un article offert
  n'a pas de prix en jetons (`null`), sinon il cesserait d'être offert.
- **La vitrine remise aussi les jetons**, sur le prix en jetons du catalogue.
- **Le joueur choisit sa monnaie** (protocole 2.2.0,
  `inventoryBuyRequest.currency`). Choisie, elle est la seule prélevée : aucun
  repli sur l'autre poche. Le prix reste celui du serveur.
- **Le crédit des jetons se fait dans la transaction de l'expérience** : jamais
  un niveau sans ses jetons.

## Conséquences

- La monnaie dure devient visible et désirable avant tout achat réel.
- **L'achat de jetons avec de l'argent réel n'est pas construit.** Sur iOS et
  Android, il passe par les achats intégrés des stores. Le choix d'intégration
  (StoreKit et Google Play Billing directement, ou un intermédiaire) reste à
  faire : c'est une décision du propriétaire du jeu, pas du code.
- Le taux (10 pour 1) et le gain par niveau vivent chacun à un seul endroit ;
  les changer passe par un test et `docs/01`.
