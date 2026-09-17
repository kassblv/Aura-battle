import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MatchGateway } from './adapters/match.gateway.js';
import { SocketNotifier } from './adapters/socket-notifier.js';
import { SystemMatchClock, TimeoutScheduler } from './adapters/timeout-scheduler.js';
import { InviteService } from './application/invites.js';
import { MatchRuntime } from './application/match-runtime.js';

/**
 * Module match (docs/02-architecture.md).
 *
 * Le runtime recoit ses ports ici : envoyer passe par les sockets, les
 * echeances par `setTimeout`, le temps par l'horloge systeme. Aucun des trois
 * n'est connu du runtime lui-meme, ce qui permet de jouer un match entier dans
 * un test sans attendre une seule seconde reelle.
 */
@Module({
  imports: [AuthModule],
  providers: [
    SocketNotifier,
    TimeoutScheduler,
    SystemMatchClock,
    InviteService,
    {
      provide: MatchRuntime,
      inject: [SocketNotifier, TimeoutScheduler, SystemMatchClock],
      useFactory: (
        notifier: SocketNotifier,
        scheduler: TimeoutScheduler,
        clock: SystemMatchClock,
      ) => new MatchRuntime(notifier, scheduler, clock),
    },
    MatchGateway,
  ],
  exports: [MatchGateway, MatchRuntime],
})
export class MatchModule {}
