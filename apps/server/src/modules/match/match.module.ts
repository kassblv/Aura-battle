import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MatchGateway } from './adapters/match.gateway.js';

/**
 * Module match (docs/02-architecture.md).
 *
 * Pour l'instant il n'expose que la passerelle : authentification, limite de
 * debit, validation. La machine d'etat du match s'y branchera ensuite, en
 * consommant `@aura/rules` sans reimplementer la moindre regle.
 */
@Module({
  imports: [AuthModule],
  providers: [MatchGateway],
  exports: [MatchGateway],
})
export class MatchModule {}
