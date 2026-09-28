import { describeCause } from '../../../shared/describe-cause.js';
import { ERROR_WINDOW_MS, type ErrorLog, type ErrorWindow } from '../domain/error-log.js';
import type { AdminProbes, ComponentStatus, DatabaseSnapshot } from '../domain/ports.js';
import { backupVerdict, overallVerdict, type Verdict } from '../domain/status.js';

/**
 * Ce que le panneau d'administration montre.
 *
 * **En lecture seule.** Aucune route n'ecrit quoi que ce soit : un panneau
 * qui agit est une porte de plus, et celle-ci serait la plus interessante du
 * systeme. Surveiller d'abord ; agir viendra avec ses propres garanties.
 */

export interface AdminStatus {
  readonly overall: Verdict;
  readonly components: readonly ComponentStatus[];
  readonly database: DatabaseSnapshot | null;
  /** Secondes depuis le demarrage du processus. */
  readonly uptimeSeconds: number;
  /** Le commit deploye, ou `inconnu` si l'image ne le porte pas. */
  readonly commit: string;
  /** Quand l'image a ete construite, ou `null` si elle ne le dit pas. */
  readonly builtAt: string | null;
  readonly errors: ErrorWindow;
}

export interface AdminStatusDependencies {
  readonly probes: AdminProbes;
  readonly errors: ErrorLog;
  readonly now: () => number;
  readonly uptimeSeconds: () => number;
  readonly commit: string;
  readonly builtAt: () => string | null;
}

/** Interroge une sonde sans jamais laisser son echec emporter le tableau. */
async function probe<T>(run: () => Promise<T | null>): Promise<T | null> {
  try {
    return await run();
  } catch {
    /*
      Une sonde qui leve ne doit pas emporter le tableau de bord : c'est
      justement quand quelque chose casse qu'on vient le regarder. L'echec
      devient un verdict, pas une page blanche.
    */
    return null;
  }
}

function since(at: Date | null, nowMs: number): string {
  if (at === null) return 'jamais';
  const minutes = Math.max(0, Math.round((nowMs - at.getTime()) / 60_000));
  if (minutes < 60) return `il y a ${String(minutes)} min`;
  const heures = Math.round(minutes / 60);
  return heures < 48 ? `il y a ${String(heures)} h` : `il y a ${String(Math.round(heures / 24))} j`;
}

export class AdminStatusService {
  constructor(private readonly deps: AdminStatusDependencies) {}

  async read(): Promise<AdminStatus> {
    const nowMs = this.deps.now();

    // Les trois sondes partent ensemble : les enchainer tripleraient
    // l'attente d'une page qu'on ouvre justement quand on est presse.
    const [database, queue, lastBackup] = await Promise.all([
      probe(() => this.deps.probes.database()),
      probe(() => this.deps.probes.queue()),
      probe(() => this.deps.probes.lastBackup()),
    ]);

    const components: ComponentStatus[] = [
      {
        name: 'Base de données',
        verdict: database === null ? 'down' : 'ok',
        detail:
          database === null
            ? 'injoignable'
            : `${String(database.players)} joueurs · ${String(database.matchesLastDay)} matchs aujourd’hui`,
      },
      {
        name: 'File d’attente',
        verdict: queue === null ? 'down' : 'ok',
        detail: queue === null ? 'Redis injoignable' : `${String(queue.waiting)} en attente`,
      },
      {
        name: 'Sauvegarde',
        verdict: backupVerdict(lastBackup, nowMs),
        detail: since(lastBackup, nowMs),
      },
    ];

    return {
      overall: overallVerdict(components.map((component) => component.verdict)),
      components,
      database,
      uptimeSeconds: this.deps.uptimeSeconds(),
      commit: this.deps.commit,
      builtAt: this.deps.builtAt(),
      /*
        Le compteur se lit A COTE de la duree de fonctionnement : remis a zero
        au redemarrage, il ne trompe personne tant que les deux sont affiches
        ensemble.
      */
      errors: this.deps.errors.since(ERROR_WINDOW_MS),
    };
  }

  /** Note une erreur telle qu'un journal la decrirait. */
  record(cause: unknown): void {
    this.deps.errors.record(describeCause(cause));
  }
}
