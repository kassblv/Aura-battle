import type { ReactNode } from 'react';
import { href, type Route } from './router.js';

const NAV: readonly {
  readonly name: Route['name'];
  readonly label: string;
  readonly href: string;
}[] = [
  { name: 'dashboard', label: 'Tableau de bord', href: href.dashboard },
  { name: 'experiments', label: 'Expériences', href: href.experiments },
  { name: 'events', label: 'Événements', href: href.events },
  { name: 'players', label: 'Joueurs', href: href.players },
  { name: 'audit', label: 'Journal', href: href.audit },
];

export function Shell({
  section,
  onLogout,
  children,
}: {
  readonly section: Route['name'];
  readonly onLogout: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Aller au contenu
      </a>
      <header className="shell__bar">
        <p className="shell__brand">
          Aura Battle <span className="shell__brand-sub">admin</span>
        </p>
        <nav className="shell__nav" aria-label="Sections">
          {NAV.map((item) => (
            <a
              key={item.name}
              className={item.name === section ? 'shell__link shell__link--active' : 'shell__link'}
              href={item.href}
              aria-current={item.name === section ? 'page' : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <button type="button" className="btn btn--ghost shell__logout" onClick={onLogout}>
          Se déconnecter
        </button>
      </header>
      <main className="shell__main" id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
