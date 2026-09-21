/**
 * La page du panneau d'administration.
 *
 * Une chaine dans le serveur, et non un fichier du client : elle n'a rien a
 * faire dans le paquet que telechargent les joueurs, et elle n'a besoin ni de
 * React, ni de Three.js, ni d'une etape de construction. Une page qu'on peut
 * lire en entier est une page dont on peut verifier qu'elle ne fait rien
 * d'autre que ce qu'elle dit.
 *
 * Elle ne contient aucun secret : c'est l'API qui garde. Le secret saisi vit
 * dans `sessionStorage` — il disparait avec l'onglet, ce qui est le bon
 * comportement pour un jeton d'administration sur une machine partagee.
 */
export const ADMIN_PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Aura Battle — administration</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #150c2e; --surface: #221545; --line: #453380;
    --ink: #f3ecff; --muted: #a99cd0;
    --ok: #5be3a0; --warn: #ffcf3f; --down: #ff6b81;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); padding: 24px 16px; }
  main { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 20px; letter-spacing: .04em; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 13px; margin: 0 0 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
  .card h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 10px; font-weight: 600; }
  .line { display: flex; align-items: baseline; gap: 9px; padding: 5px 0; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .ok { background: var(--ok); } .warn { background: var(--warn); } .down { background: var(--down); }
  .name { font-weight: 600; font-size: 14px; }
  .detail { color: var(--muted); font-size: 13px; margin-left: auto; text-align: right; }
  .stat { display: flex; justify-content: space-between; padding: 5px 0; font-size: 14px; }
  .stat span:last-child { font-variant-numeric: tabular-nums; font-weight: 700; }
  .err { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: var(--muted); padding: 4px 0; border-bottom: 1px solid var(--line); word-break: break-word; }
  form { display: flex; gap: 8px; margin-bottom: 18px; }
  /*
    Redeclare, parce qu'une regle d'auteur bat TOUJOURS celle du navigateur,
    quelle que soit la specificite. Sans cette ligne, \`form { display: flex }\`
    l'emporte sur le \`[hidden] { display: none }\` de la feuille par defaut, et
    le formulaire de secret reste a l'ecran apres l'authentification.
  */
  [hidden] { display: none !important; }
  input, button { font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); }
  button { cursor: pointer; font-weight: 700; }
  .note { color: var(--muted); font-size: 12px; margin-top: 18px; line-height: 1.5; }
  .bad { color: var(--down); }
</style>
</head>
<body>
<main>
  <h1>Aura Battle — administration</h1>
  <p class="sub" id="sub">Lecture seule. Rien sur cette page n’écrit quoi que ce soit.</p>

  <form id="porte">
    <input id="secret" type="password" placeholder="Secret d’administration" autocomplete="off" style="flex:1" />
    <button type="submit">Entrer</button>
  </form>

  <div id="tableau" hidden>
    <div class="grid">
      <div class="card"><h2>État</h2><div id="composants"></div></div>
      <div class="card"><h2>Chiffres</h2><div id="chiffres"></div></div>
      <div class="card"><h2>Serveur</h2><div id="serveur"></div></div>
    </div>
    <div class="card" style="margin-top:12px"><h2>Erreurs (24 h)</h2><div id="erreurs"></div></div>
    <p class="note">
      Le compteur d’erreurs vit en mémoire : il repart de zéro à chaque redémarrage.
      C’est pour ça qu’il se lit à côté de la durée de fonctionnement — les deux
      ensemble ne trompent personne.
    </p>
  </div>
</main>
<script>
(() => {
  const CLE = 'aura.admin';
  const $ = (id) => document.getElementById(id);
  const txt = (v) => String(v ?? '');

  function duree(s) {
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.round(s / 60) + ' min';
    if (s < 172800) return Math.round(s / 3600) + ' h';
    return Math.round(s / 86400) + ' j';
  }

  function ligne(c) {
    const d = document.createElement('div');
    d.className = 'line';
    const p = document.createElement('i');
    p.className = 'dot ' + c.verdict;
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = c.name;
    const t = document.createElement('span');
    t.className = 'detail';
    t.textContent = c.detail;
    d.append(p, n, t);
    return d;
  }

  function stat(nom, valeur) {
    const d = document.createElement('div');
    d.className = 'stat';
    const a = document.createElement('span');
    a.textContent = nom;
    const b = document.createElement('span');
    b.textContent = txt(valeur);
    d.append(a, b);
    return d;
  }

  async function charger(secret) {
    const r = await fetch('/admin/status', { headers: { authorization: 'Bearer ' + secret } });
    if (r.status === 401) throw new Error('Secret refusé.');
    if (!r.ok) throw new Error('Le serveur a refusé (' + r.status + ').');
    return r.json();
  }

  function dessiner(s) {
    $('composants').replaceChildren(...s.components.map(ligne));

    const db = s.database;
    $('chiffres').replaceChildren(
      stat('Joueurs', db ? db.players : '—'),
      stat('Classés', db ? db.rankedPlayers : '—'),
      stat('Matchs (24 h)', db ? db.matchesLastDay : '—'),
      stat('Matchs au total', db ? db.matchesTotal : '—'),
    );

    $('serveur').replaceChildren(
      stat('Debout depuis', duree(s.uptimeSeconds)),
      stat('Commit', s.commit),
      stat('Erreurs (24 h)', s.errors.total),
    );

    const erreurs = s.errors.recent;
    if (erreurs.length === 0) {
      const vide = document.createElement('div');
      vide.className = 'err';
      vide.textContent = 'Aucune.';
      $('erreurs').replaceChildren(vide);
    } else {
      $('erreurs').replaceChildren(...erreurs.map((e) => {
        const d = document.createElement('div');
        d.className = 'err';
        d.textContent = new Date(e.at).toLocaleTimeString('fr-FR') + ' · ' + e.message;
        return d;
      }));
    }

    $('sub').textContent = 'Lecture seule · rafraîchi ' + new Date().toLocaleTimeString('fr-FR');
    $('sub').classList.remove('bad');
  }

  async function ouvrir(secret) {
    try {
      dessiner(await charger(secret));
      sessionStorage.setItem(CLE, secret);
      $('porte').hidden = true;
      $('tableau').hidden = false;
      // Toutes les quinze secondes : assez pour voir bouger, assez peu pour
      // ne pas peser sur un serveur qu'on regarde justement parce qu'il
      // souffre peut-etre.
      clearInterval(window.__t);
      window.__t = setInterval(async () => {
        try { dessiner(await charger(secret)); }
        catch (e) { $('sub').textContent = e.message; $('sub').classList.add('bad'); }
      }, 15000);
    } catch (e) {
      $('sub').textContent = e.message;
      $('sub').classList.add('bad');
      sessionStorage.removeItem(CLE);
    }
  }

  $('porte').addEventListener('submit', (e) => {
    e.preventDefault();
    ouvrir($('secret').value.trim());
  });

  const garde = sessionStorage.getItem(CLE);
  if (garde) ouvrir(garde);
})();
</script>
</body>
</html>`;
