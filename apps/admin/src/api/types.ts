import type {
  adminAuditResponseSchema,
  adminEventsResponseSchema,
  adminFlagsResponseSchema,
  adminPlayerSearchResponseSchema,
} from '@aura/protocol';
import type { z } from 'zod';

export type {
  AdminAction,
  AdminFlagState,
  AdminFlagUpdateRequest,
  AdminPlayerDetail,
  AdminPlayerSummary,
  AdminWeekEvent,
} from '@aura/protocol';

export type AdminFlagsResponse = z.infer<typeof adminFlagsResponseSchema>;
export type AdminEventsResponse = z.infer<typeof adminEventsResponseSchema>;
export type AdminPlayerSearchResponse = z.infer<typeof adminPlayerSearchResponseSchema>;
export type AdminAuditResponse = z.infer<typeof adminAuditResponseSchema>;
