import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { CONTENT_VERSION } from '@aura/content';
import { PROTOCOL_VERSION } from '@aura/protocol';
import { RULES_VERSION } from '@aura/rules';
import { CONFIG, type ServerConfig } from '../../shared/config.js';
import {
  MessageMetrics,
  type MetricsDisabled,
  type MetricsSnapshot,
} from '../../shared/metrics.js';

/** Prefixe attendu dans l'en-tete `Authorization` des routes de mesure. */
const BEARER = 'Bearer ';

/**
 * Sonde de sante.
 *
 * Elle annonce les trois versions qui doivent concorder entre le serveur et le
 * client. Un noeud qui sert une version de regles differente des autres est un
 * incident : un match ne doit jamais melanger deux versions (docs/03).
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(MessageMetrics) private readonly metrics: MessageMetrics,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /**
   * Refuse qui n'a pas le secret, des que la mesure tourne.
   *
   * Eteinte, il n'y a rien a proteger : le relevé est vide et la remise a zero
   * ne fait rien. Allumee, les deux routes disent et defont des choses qui ne
   * regardent que l'exploitant — `loadConfig` exige alors un secret, donc le
   * cas « allumee sans secret » n'existe pas.
   *
   * La comparaison est a longueur constante : une egalite de chaines qui sort
   * au premier octet different laisse deviner le secret octet par octet.
   */
  private authorize(header: string | undefined): void {
    if (!this.config.metricsEnabled) return;

    const offered = header?.startsWith(BEARER) === true ? header.slice(BEARER.length) : '';
    if (!constantTimeEquals(offered, this.config.metricsToken)) {
      throw new UnauthorizedException('Secret de mesure invalide');
    }
  }

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
  metricsSnapshot(
    @Headers('authorization') authorization?: string,
  ): MetricsSnapshot | MetricsDisabled {
    this.authorize(authorization);
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
  resetMetrics(@Headers('authorization') authorization?: string): { reset: boolean } {
    this.authorize(authorization);
    this.metrics.reset();
    return { reset: this.metrics.enabled };
  }
}

/**
 * Egalite de chaines qui ne s'arrete pas au premier octet different.
 *
 * `timingSafeEqual` exige deux tampons de meme longueur et leve sinon — ce qui
 * rendrait la longueur du secret devinable par l'erreur elle-meme. On hache
 * donc les deux cotes avant de comparer : meme taille par construction, quelle
 * que soit celle des entrees.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
