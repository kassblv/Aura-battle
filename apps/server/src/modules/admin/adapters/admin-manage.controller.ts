import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  adminAuditResponseSchema,
  adminBanRequestSchema,
  adminEventOverrideRequestSchema,
  adminEventsResponseSchema,
  adminFlagsResponseSchema,
  adminFlagUpdateRequestSchema,
  adminPlayerDetailSchema,
  adminPlayerSearchQuerySchema,
  adminPlayerSearchResponseSchema,
  adminUnbanRequestSchema,
} from '@aura/protocol';
import { z } from 'zod';
import { FeatureFlags } from '../../flags/application/feature-flags.js';
import { InvalidFlagActionError, isFlagName } from '../../flags/domain/flags.js';
import {
  InvalidEventOverrideError,
  RuleEventsService,
} from '../../rule-events/application/rule-events.service.js';
import { AdminPlayersService, InvalidBanError } from '../application/admin-players.service.js';
import { ADMIN_AUDIT_READER, type AdminAuditReader } from '../domain/ports.js';
import { AdminGuard } from './admin.guard.js';

/** Lignes du journal rendues, au plus (contrat : 100). */
const AUDIT_LIMIT = 100;

/** Les filtres du journal, bornes : une action est un identifiant, une cible une ligne courte. */
const auditQuerySchema = z.strictObject({
  action: z
    .string()
    .regex(/^[a-z][a-z.-]{0,39}$/)
    .optional(),
  target: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[\x20-\x7e]+$/)
    .optional(),
});

/** Un identifiant de joueur plausible, avant toute lecture : uuid, ou identifiant de test. */
const PLAYER_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Un numero de semaine ecrit en chiffres, et rien d'autre. */
const WEEK = /^\d{1,7}$/;

const invalid = (message: string): BadRequestException =>
  new BadRequestException({ code: 'INVALID_PAYLOAD', message });

/** Une requete lue par son schema, ou une 400 qui dit le premier probleme. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue === undefined || issue.path.length === 0 ? 'corps' : issue.path.join('.');
    throw invalid(`${path} : ${issue?.message ?? 'invalide'}`);
  }
  return parsed.data;
}

/**
 * Une reponse verifiee par le contrat avant de partir. Une reponse qui ne le
 * suit pas est un defaut du serveur : une 500, jamais une reponse que
 * l'application refuserait en silence.
 */
function respond<T>(schema: z.ZodType<T>, value: unknown): T {
  const checked = schema.safeParse(value);
  if (!checked.success) throw new InternalServerErrorException({ code: 'INTERNAL' });
  return checked.data;
}

/** Un parametre de requete lu une fois : un parametre repete n'est pas une valeur. */
const single = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * Ce que le panneau GERE (ADR 0018) : drapeaux, evenement de la semaine,
 * joueurs, journal.
 *
 * Chaque entree est validee par le contrat de `@aura/protocol` ; chaque
 * ecriture passe par le service qui applique les regles du jeu, et laisse sa
 * ligne de journal dans la meme transaction. Aucune route ne touche aux
 * portefeuilles.
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminManageController {
  // Jetons explicites : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(
    @Inject(FeatureFlags) private readonly flags: FeatureFlags,
    @Inject(RuleEventsService) private readonly events: RuleEventsService,
    @Inject(AdminPlayersService) private readonly players: AdminPlayersService,
    @Inject(ADMIN_AUDIT_READER) private readonly audit: AdminAuditReader,
  ) {}

  @Get('flags')
  @Header('cache-control', 'no-store')
  readFlags(): z.infer<typeof adminFlagsResponseSchema> {
    return respond(adminFlagsResponseSchema, this.flagsView());
  }

  /** Couper, rallumer a la part de la mesure, ou ouvrir une nouvelle mesure. */
  @Put('flags/:flag')
  @Header('cache-control', 'no-store')
  async updateFlag(
    @Param('flag') flag: string,
    @Body() body: unknown,
  ): Promise<z.infer<typeof adminFlagsResponseSchema>> {
    if (!isFlagName(flag)) throw new NotFoundException({ code: 'NOT_FOUND' });
    const request = parse(adminFlagUpdateRequestSchema, body);
    const { reason, ...action } = request;
    try {
      await this.flags.update(flag, action, reason ?? null);
    } catch (cause) {
      if (cause instanceof InvalidFlagActionError) throw invalid(cause.message);
      throw cause;
    }
    return respond(adminFlagsResponseSchema, this.flagsView());
  }

  @Get('events')
  @Header('cache-control', 'no-store')
  readEvents(): z.infer<typeof adminEventsResponseSchema> {
    return respond(adminEventsResponseSchema, this.events.adminView());
  }

  /** Forcer une semaine, ou la rendre a la rotation (`variant: null`). */
  @Put('events/:week')
  @Header('cache-control', 'no-store')
  async overrideEvent(
    @Param('week') week: string,
    @Body() body: unknown,
  ): Promise<z.infer<typeof adminEventsResponseSchema>> {
    if (!WEEK.test(week)) throw invalid('semaine illisible');
    const request = parse(adminEventOverrideRequestSchema, body);
    try {
      await this.events.setOverride(Number(week), request.variant, request.reason ?? null);
    } catch (cause) {
      if (cause instanceof InvalidEventOverrideError) throw invalid(cause.message);
      throw cause;
    }
    return respond(adminEventsResponseSchema, this.events.adminView());
  }

  @Get('players')
  @Header('cache-control', 'no-store')
  async searchPlayers(
    @Query('q') q: unknown,
  ): Promise<z.infer<typeof adminPlayerSearchResponseSchema>> {
    const query = parse(adminPlayerSearchQuerySchema, { q: single(q) });
    return respond(adminPlayerSearchResponseSchema, await this.players.search(query.q));
  }

  @Get('players/:id')
  @Header('cache-control', 'no-store')
  async readPlayer(@Param('id') id: string): Promise<z.infer<typeof adminPlayerDetailSchema>> {
    return respond(
      adminPlayerDetailSchema,
      this.found(await this.players.detail(this.playerId(id))),
    );
  }

  /** Bannir jusqu'a une date, ou definitivement. Motif obligatoire. */
  @Post('players/:id/ban')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'no-store')
  async ban(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<z.infer<typeof adminPlayerDetailSchema>> {
    const playerId = this.playerId(id);
    const request = parse(adminBanRequestSchema, body);
    try {
      return respond(
        adminPlayerDetailSchema,
        this.found(await this.players.ban(playerId, request)),
      );
    } catch (cause) {
      if (cause instanceof InvalidBanError) throw invalid(cause.message);
      throw cause;
    }
  }

  @Post('players/:id/unban')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'no-store')
  async unban(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<z.infer<typeof adminPlayerDetailSchema>> {
    const playerId = this.playerId(id);
    const request = parse(adminUnbanRequestSchema, body);
    return respond(
      adminPlayerDetailSchema,
      this.found(await this.players.unban(playerId, request)),
    );
  }

  /** Les cent dernieres actions, filtrables par action et par cible exactes. */
  @Get('audit')
  @Header('cache-control', 'no-store')
  async readAudit(
    @Query('action') action: unknown,
    @Query('target') target: unknown,
  ): Promise<z.infer<typeof adminAuditResponseSchema>> {
    const raw = { action: single(action), target: single(target) };
    const filter = parse(auditQuerySchema, {
      ...(raw.action === undefined ? {} : { action: raw.action }),
      ...(raw.target === undefined ? {} : { target: raw.target }),
    });
    const rows = await this.audit.latest(
      {
        ...(filter.action === undefined ? {} : { action: filter.action }),
        ...(filter.target === undefined ? {} : { target: filter.target }),
      },
      AUDIT_LIMIT,
    );
    return respond(adminAuditResponseSchema, {
      actions: rows.slice(0, AUDIT_LIMIT).map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        action: row.action.slice(0, 40),
        target: row.target.slice(0, 80),
        before: row.before ?? null,
        after: row.after ?? null,
        reason: row.reason === null ? null : row.reason.slice(0, 200),
      })),
    });
  }

  private flagsView() {
    return {
      flags: this.flags.declared().map((state) => ({
        flag: state.flag,
        rollout: state.rollout,
        measureRollout: state.measureRollout,
        epoch: state.epoch,
        measureStartedAt: new Date(state.measureStartedAtMs).toISOString(),
      })),
    };
  }

  /** Un identifiant mal forme ne va pas jusqu'a la base : pour le panneau, il n'existe pas. */
  private playerId(id: string): string {
    if (!PLAYER_ID.test(id)) throw new NotFoundException({ code: 'NOT_FOUND' });
    return id;
  }

  private found<T>(value: T | null): T {
    if (value === null) throw new NotFoundException({ code: 'NOT_FOUND' });
    return value;
  }
}
