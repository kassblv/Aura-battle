import {
  adminAuditResponseSchema,
  adminBanRequestSchema,
  adminEventOverrideRequestSchema,
  adminEventsResponseSchema,
  adminFlagUpdateRequestSchema,
  adminFlagsResponseSchema,
  adminPlayerDetailSchema,
  adminPlayerSearchResponseSchema,
  adminUnbanRequestSchema,
  lenient,
  type AdminBanRequest,
  type AdminEventOverrideRequest,
  type AdminFlagUpdateRequest,
} from '@aura/protocol';
import type { z } from 'zod';
import { adminStatusSchema, experimentReportSchema, indicatorReportSchema } from './dashboard.js';

/**
 * Le client HTTP du panneau.
 *
 * Trois regles, testees :
 *  - le secret voyage dans l'en-tete `Authorization`, JAMAIS dans l'URL (une
 *    URL finit dans les journaux du proxy, l'historique, le `Referer`) ;
 *  - chaque reponse est validee par le contrat (`lenient` : un champ ajoute
 *    par un serveur plus recent est ignore, un champ faux est une erreur) ;
 *  - chaque corps de requete est valide AVANT l'envoi par le meme schema
 *    strict que le serveur applique : une erreur de saisie se dit ici, pas
 *    en 400 incompréhensible.
 */

export type AdminApiErrorKind =
  | 'unauthorized'
  | 'rate-limited'
  | 'not-found'
  | 'bad-request'
  | 'server'
  | 'invalid-response'
  | 'invalid-request'
  | 'network';

export class AdminApiError extends Error {
  constructor(
    readonly kind: AdminApiErrorKind,
    message: string,
    readonly status: number | null = null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export interface AdminApiDeps {
  readonly fetch: typeof fetch;
  /** Le secret en vigueur, lu a chaque appel (il peut changer ou disparaitre). */
  readonly token: () => string | null;
  /** Le serveur a refuse le secret : on repart a l'ecran de connexion. */
  readonly onUnauthorized: () => void;
  /** Prefixe des routes ; `/admin` en production comme en dev (proxy). */
  readonly base?: string;
}

type Method = 'GET' | 'PUT' | 'POST';

/** Message d'erreur en francais, selon le statut. */
export function describeStatus(status: number, code: string | null, detail: string | null): string {
  const suffix = code === null ? `${status}` : `${status} · ${code}`;
  if (status === 401) return 'Secret refusé : reconnecte-toi.';
  if (status === 429) return 'Trop d’essais, attends une minute.';
  if (status === 404) {
    return `Introuvable (${suffix}). Si toutes les pages répondent ainsi, le panneau est désactivé : aucun secret n’est configuré sur le serveur.`;
  }
  const tail = detail === null ? '' : ` : ${detail}`;
  if (status >= 400 && status < 500) return `Refusé par le serveur (${suffix})${tail}`;
  return `Erreur du serveur (${suffix})${tail}`;
}

function kindOf(status: number): AdminApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 429) return 'rate-limited';
  if (status === 404) return 'not-found';
  if (status >= 400 && status < 500) return 'bad-request';
  return 'server';
}

/** Le premier probleme d'une validation, en une ligne : `flags.0.rollout : …`. */
export function describeIssues(error: z.ZodError): string {
  const first = error.issues[0];
  if (first === undefined) return 'forme inconnue';
  const path = first.path.length === 0 ? 'racine' : first.path.map(String).join('.');
  const more = error.issues.length > 1 ? ` (+${error.issues.length - 1} autre(s))` : '';
  return `${path} : ${first.message}${more}`;
}

async function readErrorBody(
  response: Response,
): Promise<{ code: string | null; detail: string | null }> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return { code: null, detail: null };
    const record = body as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code : null;
    const raw = record.message;
    const detail =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? raw.filter((m) => typeof m === 'string').join(' ; ')
          : null;
    return { code, detail: detail === '' || detail === code ? null : detail };
  } catch {
    return { code: null, detail: null };
  }
}

export function createAdminApi(deps: AdminApiDeps) {
  const base = deps.base ?? '/admin';

  async function send(method: Method, path: string, body?: unknown): Promise<Response> {
    const token = deps.token();
    if (token === null || token === '') {
      deps.onUnauthorized();
      throw new AdminApiError('unauthorized', 'Aucun secret : connecte-toi.', 401);
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await deps.fetch(`${base}${path}`, {
        method,
        headers,
        cache: 'no-store',
        credentials: 'omit',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new AdminApiError('network', 'Serveur injoignable. Vérifie ta connexion et réessaie.');
    }
    if (!response.ok) {
      const { code, detail } = await readErrorBody(response);
      if (response.status === 401) deps.onUnauthorized();
      throw new AdminApiError(
        kindOf(response.status),
        describeStatus(response.status, code, detail),
        response.status,
        code,
      );
    }
    return response;
  }

  async function read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await send('GET', path);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new AdminApiError(
        'invalid-response',
        `Réponse illisible de GET ${base}${path} (pas du JSON).`,
        response.status,
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AdminApiError(
        'invalid-response',
        `Réponse inattendue de GET ${base}${path} — ${describeIssues(parsed.error)}. Le serveur et le panneau n’ont peut-être pas la même version.`,
        response.status,
      );
    }
    return parsed.data;
  }

  async function write(
    method: Method,
    path: string,
    schema: z.ZodType,
    body: unknown,
  ): Promise<void> {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new AdminApiError(
        'invalid-request',
        `Saisie invalide — ${describeIssues(parsed.error)}.`,
      );
    }
    await send(method, path, parsed.data);
  }

  const id = (value: string | number): string => encodeURIComponent(String(value));

  const schemas = {
    status: lenient(adminStatusSchema),
    indicators: lenient(indicatorReportSchema),
    experiments: lenient(experimentReportSchema),
    flags: lenient(adminFlagsResponseSchema),
    events: lenient(adminEventsResponseSchema),
    search: lenient(adminPlayerSearchResponseSchema),
    player: lenient(adminPlayerDetailSchema),
    audit: lenient(adminAuditResponseSchema),
  };

  return {
    status: () => read('/status', schemas.status),
    indicators: () => read('/indicators', schemas.indicators),
    experiments: () => read('/experiments', schemas.experiments),
    flags: () => read('/flags', schemas.flags),
    updateFlag: (flag: string, body: AdminFlagUpdateRequest) =>
      write('PUT', `/flags/${id(flag)}`, adminFlagUpdateRequestSchema, body),
    events: () => read('/events', schemas.events),
    overrideEvent: (week: number, body: AdminEventOverrideRequest) =>
      write('PUT', `/events/${id(week)}`, adminEventOverrideRequestSchema, body),
    searchPlayers: (q: string) =>
      read(`/players?${new URLSearchParams({ q: q.trim() }).toString()}`, schemas.search),
    player: (playerId: string) => read(`/players/${id(playerId)}`, schemas.player),
    ban: (playerId: string, body: AdminBanRequest) =>
      write('POST', `/players/${id(playerId)}/ban`, adminBanRequestSchema, body),
    unban: (playerId: string, body: { reason: string }) =>
      write('POST', `/players/${id(playerId)}/unban`, adminUnbanRequestSchema, body),
    audit: (filters: { action?: string; target?: string } = {}) => {
      const params = new URLSearchParams();
      if (filters.action !== undefined && filters.action !== '')
        params.set('action', filters.action);
      if (filters.target !== undefined && filters.target.trim() !== '')
        params.set('target', filters.target.trim());
      const query = params.toString();
      return read(`/audit${query === '' ? '' : `?${query}`}`, schemas.audit);
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
