import { Module } from '@nestjs/common';
import { SystemClock } from '../../shared/clock.js';
import { AuthModule } from '../auth/auth.module.js';
import { ChallengesController } from './adapters/challenges.controller.js';
import { PrismaChallengeRepository } from './adapters/prisma-challenge.repository.js';
import { ChallengeService } from './application/challenges.js';

/**
 * Les defis quotidiens (docs/01 §11, jalon M8).
 *
 * Il importe `AuthModule` pour le verificateur de jetons et `PrismaService`,
 * pour la meme raison que l'inventaire : deux verificateurs seraient deux
 * endroits ou la validite d'un jeton pourrait diverger.
 *
 * `ChallengeService` est **exporte** : le module `match` s'en sert pour
 * enregistrer ce qu'une partie a rapporte. C'est le seul lien entre les deux,
 * et il va dans ce sens-la — les defis ne savent rien d'un match, ils recoivent
 * un total de mesures deja faites.
 */
@Module({
  imports: [AuthModule],
  controllers: [ChallengesController],
  providers: [
    PrismaChallengeRepository,
    {
      provide: ChallengeService,
      inject: [PrismaChallengeRepository, SystemClock],
      useFactory: (challenges: PrismaChallengeRepository, clock: SystemClock) =>
        new ChallengeService({ challenges, clock }),
    },
    SystemClock,
  ],
  exports: [ChallengeService],
})
export class ChallengesModule {}
