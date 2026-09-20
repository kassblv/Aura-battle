import { Controller, Get, Inject, Post } from '@nestjs/common';
import { CONTENT_VERSION } from '@aura/content';
import { PROTOCOL_VERSION } from '@aura/protocol';
import { RULES_VERSION } from '@aura/rules';
import {
  MessageMetrics,
  type MetricsDisabled,
  type MetricsSnapshot,
} from '../../shared/metrics.js';

/**
 * Sonde de sante.
 *
 * Elle annonce les trois versions qui doivent concorder entre le serveur et le
 * client. Un noeud qui sert une version de regles differente des autres est un
 * incident : un match ne doit jamais melanger deux versions (docs/03).
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(MessageMetrics) private readonly metrics: MessageMetrics) {}

  @Get()
  check(): {
    status: 'ok';
    protocolVersion: string;
    rulesVersion: string;
    contentVersion: string;
  } {
    return {
      status: 'ok',
      protocolVersion: PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      contentVersion: CONTENT_VERSION,
    };
  }

  /**
   * Relevé de charge (jalon M7, `AURA_METRICS=1`).
   *
   * Sans le drapeau, la route existe mais ne rend que `{ enabled: false }` :
   * un banc de charge lance contre un serveur non instrumente doit s'en
   * apercevoir tout de suite, pas conclure a zero message traite.
   *
   * Ce qui sort d'ici est agrege et anonyme — des comptes, des percentiles, un
   * nombre de matchs vivants. Aucun identifiant de joueur, aucun etat de match,
   * rien qui puisse renseigner un adversaire (regle d'or n°4).
   */
  @Get('metrics')
  metricsSnapshot(): MetricsSnapshot | MetricsDisabled {
    return this.metrics.snapshot();
  }

  /**
   * Repart d'une fenetre de mesure vide.
   *
   * La montee en charge d'un banc — mille connexions, mille authentifications
   * — n'a rien a voir avec le regime etabli qu'on veut mesurer. Sans cette
   * remise a zero, elle deplacerait tous les percentiles du relevé.
   */
  @Post('metrics/reset')
  resetMetrics(): { reset: boolean } {
    this.metrics.reset();
    return { reset: this.metrics.enabled };
  }
}
