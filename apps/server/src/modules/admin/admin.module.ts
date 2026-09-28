import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Module } from '@nestjs/common';
import { CONFIG, type ServerConfig } from '../../shared/config.js';
import { RedisModule } from '../../shared/redis.module.js';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { PlayerBanEvents } from '../auth/application/ban-events.js';
import { AuthModule } from '../auth/auth.module.js';
import { FlagsModule } from '../flags/flags.module.js';
import { RuleEventsModule } from '../rule-events/rule-events.module.js';
import { ADMIN_APP_DIR, AdminAppController } from './adapters/admin-app.controller.js';
import { AdminManageController } from './adapters/admin-manage.controller.js';
import { AdminController } from './adapters/admin.controller.js';
import { AdminGuard } from './adapters/admin.guard.js';
import { RealAdminProbes } from './adapters/admin-probes.js';
import { PrismaAdminAuditReader } from './adapters/prisma-admin-audit.reader.js';
import { PrismaAdminPlayerStore } from './adapters/prisma-admin-player.store.js';
import { AdminGate } from './application/admin-gate.js';
import { AdminPlayersService } from './application/admin-players.service.js';
import { AdminStatusService } from './application/admin-status.service.js';
import { createErrorLog } from './domain/error-log.js';
import { ADMIN_AUDIT_READER } from './domain/ports.js';

/**
 * L'instant de construction de l'image, lu une fois.
 *
 * Le fichier est grave par le Dockerfile et ne change jamais : le relire a
 * chaque appel du panneau serait une lecture disque par rafraichissement, pour
 * une valeur constante. Absent en developpement — on rend `null`, et le
 * panneau dit « inconnue » plutot que d'inventer.
 */
const BUILT_AT: string | null = (() => {
  try {
    const raw = readFileSync('/repo/.build-time', 'utf8').trim();
    return raw === '' ? null : raw;
  } catch {
    return null;
  }
})();

/**
 * `apps/admin/dist`, vu depuis ce fichier : `src/modules/admin/` en
 * developpement comme `dist/modules/admin/` une fois compile, quatre niveaux
 * sous `apps/`.
 */
const DEFAULT_ADMIN_DIR = fileURLToPath(new URL('../../../../admin/dist', import.meta.url));

/**
 * Le panneau d'administration (docs/10, ADR 0018) : il montre, et il GERE —
 * drapeaux, evenement de la semaine, joueurs — chaque ecriture laissant sa
 * ligne de journal dans la meme transaction.
 *
 * `AuthModule` pour `PrismaService` et les evenements de bannissement : le
 * panneau n'authentifie PAS par jeton de joueur. Son secret vit dans
 * l'environnement, hors de la base — un drapeau d'administrateur sur `Player`
 * mettrait le privilege le plus eleve du systeme dans la meme ligne qu'un
 * compte invite que n'importe quel navigateur peut creer.
 */
@Module({
  // `AnalyticsModule` pour les indicateurs, `FlagsModule` et `RuleEventsModule`
  // pour ce que le panneau regle.
  imports: [AuthModule, RedisModule, AnalyticsModule, FlagsModule, RuleEventsModule],
  // L'ordre n'importe pas au routeur : les routes d'API, statiques ou
  // parametrees, l'emportent toujours sur le joker de la page.
  controllers: [AdminController, AdminManageController, AdminAppController],
  providers: [
    RealAdminProbes,
    PrismaAdminPlayerStore,
    PrismaAdminAuditReader,
    AdminGuard,
    {
      // Un seul exemplaire : les compteurs d'essais rates vivent en memoire.
      provide: AdminGate,
      inject: [CONFIG],
      useFactory: (config: ServerConfig) =>
        new AdminGate({ token: () => config.adminToken, now: () => Date.now() }),
    },
    {
      provide: ADMIN_APP_DIR,
      inject: [CONFIG],
      useFactory: (config: ServerConfig) =>
        config.adminDir === '' ? DEFAULT_ADMIN_DIR : config.adminDir,
    },
    {
      provide: ADMIN_AUDIT_READER,
      inject: [PrismaAdminAuditReader],
      useFactory: (reader: PrismaAdminAuditReader) => reader,
    },
    {
      provide: AdminPlayersService,
      inject: [PrismaAdminPlayerStore, PlayerBanEvents],
      useFactory: (store: PrismaAdminPlayerStore, bans: PlayerBanEvents) =>
        new AdminPlayersService({ store, clock: { now: () => Date.now() }, bans }),
    },
    {
      provide: AdminStatusService,
      inject: [RealAdminProbes, CONFIG],
      useFactory: (probes: RealAdminProbes, config: ServerConfig) =>
        new AdminStatusService({
          probes,
          errors: createErrorLog(),
          now: () => Date.now(),
          uptimeSeconds: () => Math.round(process.uptime()),
          commit: config.commit,
          builtAt: () => BUILT_AT,
        }),
    },
  ],
  exports: [AdminStatusService],
})
export class AdminModule {}
