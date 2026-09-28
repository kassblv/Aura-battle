import { Module } from '@nestjs/common';
import { PinoLoggerService } from '../../shared/logger.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaRuleEventStore } from './adapters/prisma-rule-event.store.js';
import { WeekEventController } from './adapters/week-event.controller.js';
import { RuleEventsService } from './application/rule-events.service.js';

/**
 * L'evenement de la semaine, force ou non (ADR 0018).
 *
 * `AuthModule` pour `PrismaService` et le verificateur de jetons. Le service
 * est exporte : l'ouverture des matchs en lit les forcages (port
 * `WeekEventOverrides`), le panneau les ecrit. Nest appelle ses crochets de
 * cycle de vie : premiere lecture au demarrage, relecture toutes les trente
 * secondes.
 */
@Module({
  imports: [AuthModule],
  controllers: [WeekEventController],
  providers: [
    PrismaRuleEventStore,
    {
      provide: RuleEventsService,
      inject: [PrismaRuleEventStore, PinoLoggerService],
      useFactory: (store: PrismaRuleEventStore, logger: PinoLoggerService) =>
        new RuleEventsService({
          store,
          clock: { now: () => Date.now() },
          log: { warn: (message: string) => logger.warn(message, 'RuleEventsService') },
        }),
    },
  ],
  exports: [RuleEventsService],
})
export class RuleEventsModule {}
