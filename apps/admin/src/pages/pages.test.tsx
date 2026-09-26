import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Resource } from '../app/resource.js';
import * as f from '../test/fixtures.js';
import { LoginView } from './Login.js';
import { DashboardView } from './Dashboard.js';
import { ExperimentsView, describeFlagAction } from './Experiments.js';
import { EventsView, isCurrentWeek, variantChoices, variantName } from './Events.js';
import { PlayersView } from './Players.js';
import { PlayerDetailView, banActive } from './PlayerDetail.js';
import { AuditView } from './Audit.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';

const ready = <T,>(data: T): Resource<T> => ({ status: 'ready', data, refreshing: false });
const loading = { status: 'loading' } as const;
const failed = { status: 'error', error: 'Erreur du serveur (500)' } as const;
const noop = () => undefined;

describe('Connexion', () => {
  it('un champ secret etiquete, sans action de formulaire', () => {
    const html = renderToStaticMarkup(<LoginView busy={false} error={null} onSubmit={noop} />);
    expect(html).toContain('type="password"');
    expect(html).toContain('for="login-secret"');
    expect(html).not.toMatch(/<form[^>]*action=/);
  });

  it('une erreur de connexion est une alerte', () => {
    const html = renderToStaticMarkup(
      <LoginView busy={false} error="Secret refusé." onSubmit={noop} />,
    );
    expect(html).toMatch(/role="alert"[^>]*>Secret refusé\./);
  });
});

describe('Tableau de bord', () => {
  const render = (over: Partial<Parameters<typeof DashboardView>[0]> = {}) =>
    renderToStaticMarkup(
      <DashboardView
        status={ready(f.status)}
        indicators={ready(f.indicators)}
        experiments={ready(f.experiments)}
        nowMs={f.NOW}
        onRetry={noop}
        {...over}
      />,
    );

  it('montre la sante, les chiffres et le serveur', () => {
    const html = render();
    expect(html).toContain('Base de données');
    expect(html).toContain('dot dot--warn');
    expect(html).toContain('1284');
    expect(html).toContain('974ea03');
    expect(html).toContain('socket timeout');
  });

  it('montre les indicateurs : valeur, n, seuil, verdict colore, echantillon insuffisant', () => {
    const html = render();
    expect(html).toContain('43 %');
    expect(html).toContain('n = 210');
    expect(html).toContain('≥ 40 %');
    expect(html).toContain('verdict verdict--met');
    expect(html).toContain('verdict verdict--missed');
    expect(html).toContain('échantillon insuffisant');
  });

  it('montre les experiences par groupe', () => {
    const html = render();
    expect(html).toContain('Bulle d’intention');
    expect(html).toContain('Exposé');
    expect(html).toContain('Témoin');
    expect(html).toContain('42 % (n = 120)');
  });

  it('chargement et erreurs ont leur etat', () => {
    const html = render({
      status: loading,
      indicators: failed,
      experiments: ready({ at: f.NOW.toString(), experiments: [] }),
    });
    expect(html).toContain('role="status"');
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain('Aucune expérience en cours.');
  });
});

describe('Experiences', () => {
  const render = (state: Parameters<typeof ExperimentsView>[0]['state']) =>
    renderToStaticMarkup(
      <ExperimentsView
        state={state}
        busy={false}
        notice={null}
        onDismiss={noop}
        onRetry={noop}
        onAction={noop}
      />,
    );

  it('chaque drapeau : part en vigueur, mesure n° et sa part, debut, trois gestes', () => {
    const html = render(ready(f.flags));
    expect(html).toContain('Part en vigueur');
    expect(html).toContain('n°2 · 50 %');
    expect(html).toContain('Couper');
    expect(html).toContain('Rallumer à 25 %');
    expect(html).toContain('Nouvelle mesure…');
    expect(html).toContain('Coupé');
  });

  it('couper est impossible sur un drapeau deja coupe, rallumer sur un drapeau actif', () => {
    const html = render(ready({ flags: [f.flags.flags[0]!] }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Rallumer/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Couper/);
  });

  it('la confirmation d une nouvelle mesure dit qu elle repart de zero', () => {
    const body = renderToStaticMarkup(
      <>{describeFlagAction(f.flags.flags[0]!, { action: 'new-measure', rollout: 30 })}</>,
    );
    expect(body).toContain('repart de zéro');
    expect(body).toContain('mesure n°3');
  });

  it('vide, chargement, erreur', () => {
    expect(render(ready({ flags: [] }))).toContain('Aucun drapeau');
    expect(render(loading)).toContain('Chargement');
    expect(render(failed)).toContain('role="alert"');
  });
});

describe('Evenements', () => {
  const render = (state: Parameters<typeof EventsView>[0]['state']) =>
    renderToStaticMarkup(
      <EventsView
        state={state}
        nowMs={f.NOW}
        busy={false}
        notice={null}
        onDismiss={noop}
        onRetry={noop}
        onIntent={noop}
      />,
    );

  it('cinq semaines, la semaine en cours marquee, variante et source', () => {
    const html = render(ready(f.events));
    expect(html.match(/class="week( week--current)?"/g)).toHaveLength(5);
    expect(html).toContain('week week--current');
    expect(html).toContain('Double Ultime');
    expect(html).toContain('Forcée');
    expect(html).toContain('Rotation');
  });

  it('propose les variantes du serveur plus « Normale »', () => {
    const html = render(ready(f.events));
    expect(html).toContain('<option value="normal">Normale</option>');
    expect(html).toContain('<option value="fast-charge"');
    expect(variantChoices(f.events.variants)).toHaveLength(3);
    expect(variantChoices([{ id: 'normal', name: 'Normale' }])).toHaveLength(1);
    expect(variantName('inconnue', f.events.variants)).toBe('inconnue');
  });

  it('revenir a la rotation est desactive pour une semaine deja en rotation', () => {
    const html = render(ready({ ...f.events, weeks: [f.events.weeks[0]!] }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Revenir à la rotation/);
  });

  it('semaine en cours : du lundi au lundi suivant exclu', () => {
    const week = f.events.weeks[0]!;
    expect(isCurrentWeek(week, Date.parse(week.startsAt))).toBe(true);
    expect(isCurrentWeek(week, Date.parse(week.startsAt) + 7 * 86_400_000)).toBe(false);
  });

  it('vide et erreur', () => {
    expect(render(ready({ weeks: [], variants: [] }))).toContain('aucune semaine');
    expect(render(failed)).toContain('role="alert"');
  });
});

describe('Joueurs', () => {
  const render = (results: Parameters<typeof PlayersView>[0]['results'], query = 'nov') =>
    renderToStaticMarkup(
      <PlayersView query={query} onQuery={noop} results={results} onRetry={noop} />,
    );

  it('une saisie vide invite a chercher', () => {
    expect(render(null, '')).toContain('Saisis au moins un caractère');
  });

  it('les resultats menent a la fiche, les bannis sont signales', () => {
    const html = render(ready(f.search));
    expect(html).toContain('href="#/joueurs/p_1a2b3c"');
    expect(html).toContain('NovaFlash');
    expect(html).toContain('Banni');
  });

  it('aucun resultat', () => {
    expect(render(ready({ players: [] }))).toContain('Aucun joueur ne correspond.');
  });
});

describe('Fiche joueur', () => {
  const render = (state: Parameters<typeof PlayerDetailView>[0]['state']) =>
    renderToStaticMarkup(
      <PlayerDetailView
        state={state}
        nowMs={f.NOW}
        busy={false}
        notice={null}
        onDismiss={noop}
        onRetry={noop}
        onBan={noop}
        onUnban={noop}
      />,
    );

  it('nom, niveau, XP, portefeuille, ligue, matchs recents', () => {
    const html = render(ready(f.player));
    expect(html).toContain('NovaFlash');
    expect(html).toContain('Or II');
    expect(html).toContain('4 830 XP'.replace(' ', ' '));
    expect(html).toContain('Classé');
    expect(html).toContain('fantôme');
    expect(html).toContain('Nul ou inachevé');
  });

  it('non banni : formulaire de bannissement avec les cinq durees et un motif obligatoire', () => {
    const html = render(ready(f.player));
    for (const label of [
      '1 jour',
      '7 jours',
      '30 jours',
      'Définitif',
      'Jusqu’à une date précise',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/id="ban-reason"[^>]*required=""/);
    expect(html).toContain('Bannir…');
    expect(html).not.toContain('Lever le bannissement');
  });

  it('banni : bannissement en cours, motif, et formulaire de levee', () => {
    const html = render(ready(f.bannedPlayer));
    expect(html).toContain('card card--alert');
    expect(html).toContain('définitivement');
    expect(html).toContain('Programme de taps automatisé');
    expect(html).toMatch(/id="unban-reason"[^>]*required=""/);
    expect(html).not.toContain('Bannir…');
  });

  it('un bannissement echu n est plus en cours', () => {
    expect(
      banActive(
        { until: '2026-09-01T00:00:00.000Z', reason: 'x', at: '2026-08-01T00:00:00.000Z' },
        f.NOW,
      ),
    ).toBe(false);
    expect(banActive({ until: null, reason: 'x', at: '2026-08-01T00:00:00.000Z' }, f.NOW)).toBe(
      true,
    );
  });

  it('erreur du serveur : alerte', () => {
    expect(render(failed)).toContain('role="alert"');
  });

  it('le resultat d une ecriture s affiche', () => {
    const html = renderToStaticMarkup(
      <PlayerDetailView
        state={ready(f.player)}
        nowMs={f.NOW}
        busy={false}
        notice={{ kind: 'error', text: 'Refusé par le serveur (400 · BAD_REQUEST)' }}
        onDismiss={noop}
        onRetry={noop}
        onBan={noop}
        onUnban={noop}
      />,
    );
    expect(html).toMatch(/notice notice--error" role="alert"/);
    expect(html).toContain('400 · BAD_REQUEST');
  });
});

describe('Journal', () => {
  const render = (state: Parameters<typeof AuditView>[0]['state'], target = '') =>
    renderToStaticMarkup(
      <AuditView
        state={state}
        action=""
        target={target}
        onAction={noop}
        onTarget={noop}
        onRetry={noop}
      />,
    );

  it('actions, cible, motif, avant/apres repliable et formate', () => {
    const html = render(ready(f.audit));
    expect(html).toContain('Bannissement');
    expect(html).toContain('p_9z8y7x');
    expect(html).toContain('Motif : Programme de taps automatisé');
    expect(html).toContain('Sans motif.');
    expect(html).toContain('<details class="audit__diff">');
    expect(html).toContain('{\n  &quot;epoch&quot;: 1,\n  &quot;rollout&quot;: 30\n}');
  });

  it('vide avec ou sans filtre', () => {
    expect(render(ready({ actions: [] }))).toContain('Aucune action journalisée.');
    expect(render(ready({ actions: [] }), 'p_1')).toContain('pour ces filtres');
  });
});

describe('Confirmation', () => {
  it('fenetre modale etiquetee, focus sur Annuler', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        request={{
          title: 'Bannir ce joueur ?',
          body: <p>corps</p>,
          confirmLabel: 'Bannir',
          tone: 'danger',
          onConfirm: noop,
        }}
        busy={false}
        onCancel={noop}
      />,
    );
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="confirm-title"');
    expect(html).toContain('btn btn--danger');
  });

  it('rien sans demande', () => {
    expect(
      renderToStaticMarkup(<ConfirmDialog request={null} busy={false} onCancel={noop} />),
    ).toBe('');
  });
});
