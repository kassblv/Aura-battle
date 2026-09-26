import { Module } from '@nestjs/common';
import { SystemClock } from '../../shared/clock.js';
import { AuthModule } from '../auth/auth.module.js';
import { FeatureFlags } from '../flags/application/feature-flags.js';
import { FlagsModule } from '../flags/flags.module.js';
import { EventsController } from './adapters/events.controller.js';
import { PrismaIndicatorsReader } from './adapters/prisma-indicators.reader.js';
import { PrismaProductEventStore } from './adapters/prisma-product-event.store.js';
import { EventsRateLimit } from './application/events-rate-limit.js';
import { ExperimentsService } from './application/experiments.service.js';
import { IndicatorsService } from './application/indicators.service.js';
import { ProductEventsService } from './application/product-events.js';

/**
 * Les indicateurs produit (spec 2026-09-26, docs/00) : mesure interne, sans
 * fournisseur ni traceur tiers — rien ne quitte nos serveurs (docs/10).
 *
 * `AuthModule` pour le verificateur de jetons et `PrismaService`, comme le
 * passe de saison. `IndicatorsService` est exporte pour le panneau
 * d'administration, qui le garde derriere son propre secret.
 */
@Module({
  // `FlagsModule` : les experiences declarees et leur part, pour la lecture des tests A/B.
  imports: [AuthModule, FlagsModule],
  controllers: [EventsController],
  providers: [
    PrismaProductEventStore,
    PrismaIndicatorsReader,
    SystemClock,
    {
      provide: ProductEventsService,
      inject: [PrismaProductEventStore, SystemClock],
      useFactory: (store: PrismaProductEventStore, clock: SystemClock) =>
        new ProductEventsService({ store, clock }),
    },
    {
      provide: IndicatorsService,
      inject: [PrismaIndicatorsReader, SystemClock],
      useFactory: (reader: PrismaIndicatorsReader, clock: SystemClock) =>
        new IndicatorsService({ reader, clock }),
    },
    {
      provide: ExperimentsService,
      inject: [PrismaIndicatorsReader, FeatureFlags, SystemClock],
      // Le meme lecteur que les indicateurs : memes definitions, restreintes a un groupe.
      useFactory: (reader: PrismaIndicatorsReader, flags: FeatureFlags, clock: SystemClock) =>
        new ExperimentsService({ reader, experiments: flags, clock }),
    },
    // Un seul exemplaire pour le processus : les seaux vivent en memoire.
    { provide: EventsRateLimit, useFactory: () => new EventsRateLimit() },
  ],
  exports: [IndicatorsService, ExperimentsService],
})
export class AnalyticsModule {}
