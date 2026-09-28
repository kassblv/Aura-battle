import type { AdminStatus, ExperimentReport, IndicatorReport } from '../api/dashboard.js';
import type {
  AdminAuditResponse,
  AdminEventsResponse,
  AdminFlagsResponse,
  AdminPlayerDetail,
  AdminPlayerSearchResponse,
} from '../api/types.js';

/** Donnees factices conformes au contrat, partagees par les tests et le serveur de capture. */

export const NOW = Date.parse('2026-09-26T12:00:00.000Z');

const measure = (value: number | null, n: number) => ({ value, n });
const group = (players: number) => ({
  players,
  retentionD1: measure(0.42, players),
  retentionD7: measure(0.18, players),
  matchesPerActiveDay: measure(3.4, players),
  abandonRate: measure(0.05, 120),
});

export const status: AdminStatus = {
  overall: 'warn',
  components: [
    { name: 'Base de données', verdict: 'ok', detail: 'répond en 3 ms' },
    { name: 'Redis', verdict: 'ok', detail: '2 en file' },
    { name: 'Sauvegarde', verdict: 'warn', detail: 'dernière il y a 27 h' },
  ],
  database: { players: 1284, matchesTotal: 9311, matchesLastDay: 214, rankedPlayers: 402 },
  uptimeSeconds: 93_600,
  commit: '974ea03',
  builtAt: '2026-09-25T10:00:00.000Z',
  errors: { total: 1, recent: [{ at: '2026-09-26T11:40:00.000Z', message: 'socket timeout' }] },
};

export const indicators: IndicatorReport = {
  at: '2026-09-26T11:59:00.000Z',
  indicators: [
    {
      id: 'retentionD1',
      label: 'Rétention J1',
      unit: 'ratio',
      threshold: 0.4,
      comparison: 'gte',
      value: 0.43,
      n: 210,
      verdict: 'met',
    },
    {
      id: 'abandonRate',
      label: 'Taux d’abandon',
      unit: 'ratio',
      threshold: 0.08,
      comparison: 'lte',
      value: 0.11,
      n: 180,
      verdict: 'missed',
    },
    {
      id: 'timeToMatch',
      label: 'Délai de mise en relation',
      unit: 'ms',
      threshold: 20_000,
      comparison: 'lte',
      value: null,
      n: 4,
      verdict: 'insufficient',
    },
  ],
  ghostShare: measure(0.31, 540),
  rechargeInput: {
    touch: { playerMatches: 180, avgPointsPerRecharge: 40 },
    keys: { playerMatches: 22, avgPointsPerRecharge: 43.6 },
  },
};

export const experiments: ExperimentReport = {
  at: '2026-09-26T11:59:00.000Z',
  experiments: [
    { flag: 'intentBubble', rollout: 50, groups: { treatment: group(120), control: group(118) } },
  ],
};

export const flags: AdminFlagsResponse = {
  flags: [
    {
      flag: 'intentBubble',
      rollout: 50,
      measureRollout: 50,
      epoch: 2,
      measureStartedAt: '2026-09-20T08:00:00.000Z',
    },
    {
      flag: 'quickRematch',
      rollout: 0,
      measureRollout: 25,
      epoch: 1,
      measureStartedAt: '2026-09-01T08:00:00.000Z',
    },
  ],
};

export const events: AdminEventsResponse = {
  weeks: [
    {
      week: 2960,
      startsAt: '2026-09-21T00:00:00.000Z',
      variant: 'double-ultimate',
      source: 'rotation',
    },
    { week: 2961, startsAt: '2026-09-28T00:00:00.000Z', variant: 'normal', source: 'override' },
    {
      week: 2962,
      startsAt: '2026-10-05T00:00:00.000Z',
      variant: 'fast-charge',
      source: 'rotation',
    },
    {
      week: 2963,
      startsAt: '2026-10-12T00:00:00.000Z',
      variant: 'double-ultimate',
      source: 'rotation',
    },
    { week: 2964, startsAt: '2026-10-19T00:00:00.000Z', variant: 'normal', source: 'rotation' },
  ],
  variants: [
    { id: 'double-ultimate', name: 'Double Ultime' },
    { id: 'fast-charge', name: 'Recharge éclair' },
  ],
};

export const search: AdminPlayerSearchResponse = {
  players: [
    {
      id: 'p_1a2b3c',
      displayName: 'NovaFlash',
      createdAt: '2026-08-01T10:00:00.000Z',
      lastSeenAt: '2026-09-26T09:00:00.000Z',
      banned: false,
    },
    {
      id: 'p_9z8y7x',
      displayName: 'Tricheur42',
      createdAt: '2026-09-10T10:00:00.000Z',
      lastSeenAt: '2026-09-25T22:00:00.000Z',
      banned: true,
    },
  ],
};

export const player: AdminPlayerDetail = {
  id: 'p_1a2b3c',
  displayName: 'NovaFlash',
  createdAt: '2026-08-01T10:00:00.000Z',
  lastSeenAt: '2026-09-26T09:00:00.000Z',
  level: 12,
  xp: 4830,
  wallet: { soft: 1250, hard: 40 },
  league: 'Or II',
  ban: null,
  recentMatches: [
    {
      id: 'm_001',
      mode: 'RANKED',
      startedAt: '2026-09-26T08:40:00.000Z',
      endReason: 'completed',
      won: true,
      ghost: false,
    },
    {
      id: 'm_002',
      mode: 'CASUAL',
      startedAt: '2026-09-26T08:20:00.000Z',
      endReason: 'forfeit',
      won: false,
      ghost: true,
    },
    {
      id: 'm_003',
      mode: 'SOLO',
      startedAt: '2026-09-25T20:00:00.000Z',
      endReason: null,
      won: null,
      ghost: false,
    },
  ],
};

export const bannedPlayer: AdminPlayerDetail = {
  ...player,
  id: 'p_9z8y7x',
  displayName: 'Tricheur42',
  ban: { until: null, reason: 'Programme de taps automatisé', at: '2026-09-25T22:10:00.000Z' },
};

export const audit: AdminAuditResponse = {
  actions: [
    {
      id: 'a_2',
      at: '2026-09-25T22:10:00.000Z',
      action: 'player.ban',
      target: 'p_9z8y7x',
      before: { bannedUntil: null },
      after: { bannedUntil: 'permanent' },
      reason: 'Programme de taps automatisé',
    },
    {
      id: 'a_1',
      at: '2026-09-24T09:00:00.000Z',
      action: 'flag.new-measure',
      target: 'intentBubble',
      before: { epoch: 1, rollout: 30 },
      after: { epoch: 2, rollout: 50 },
      reason: null,
    },
  ],
};
