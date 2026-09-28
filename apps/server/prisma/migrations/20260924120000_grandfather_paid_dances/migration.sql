-- Les danses non offertes redeviennent payantes (docs/01 §2).
--
-- Le seed les mettait toutes a prix 0, et le serveur tient pour acquis par tous
-- ce qui vaut 0 (`Inventory.read`) : chaque joueur les possedait sans les avoir
-- achetees. Le seed applique desormais le bareme (`animationPrice`, @aura/content).
--
-- Les joueurs qui existent AVANT ce changement les gardent : on les inscrit ici,
-- une fois pour toutes, dans leur inventaire. Cette migration passe avant le seed
-- du demarrage, donc avant que les prix remontent. Base neuve : aucun joueur,
-- aucune ligne. La liste est figee a dessein — c'est l'etat d'un jour, pas une
-- regle : une danse ajoutee plus tard se vendra a tout le monde.
INSERT INTO "InventoryItem" ("playerId", "itemId", "source")
SELECT p."id", v."itemId", 'gift'
FROM "Player" p
CROSS JOIN (VALUES
  ('anim.calme.t0.behind'),
  ('anim.calme.t1.stride'),
  ('anim.calme.t2.crown'),
  ('anim.calme.t3.moonwalk'),
  ('anim.calme.t3.slowkick'),
  ('anim.calme.t4.backflip'),
  ('anim.hype.t0.jumpclap'),
  ('anim.hype.t1.shoulders'),
  ('anim.hype.t2.floss'),
  ('anim.hype.t2.goal'),
  ('anim.hype.t3.spin'),
  ('anim.hype.t4.wheel'),
  ('anim.provoc.t0.skyward'),
  ('anim.provoc.t1.tpose'),
  ('anim.provoc.t2.shrug'),
  ('anim.provoc.t2.slowclap'),
  ('anim.provoc.t3.dust'),
  ('anim.provoc.t4.bow')
) AS v("itemId")
WHERE EXISTS (SELECT 1 FROM "CosmeticItem" c WHERE c."id" = v."itemId")
ON CONFLICT ("playerId", "itemId") DO NOTHING;
