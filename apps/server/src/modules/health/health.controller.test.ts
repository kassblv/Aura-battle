import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { loadConfig, type ServerConfig } from '../../shared/config.js';
import { MessageMetrics } from '../../shared/metrics.js';
import { HealthController } from './health.controller.js';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://a',
  REDIS_URL: 'redis://a',
  JWT_SECRET: 'un-secret-assez-long',
};

const SECRET = 'jeton-de-mesure';

function controller(metricsOn: boolean): HealthController {
  const config: ServerConfig = metricsOn
    ? loadConfig({ ...BASE_ENV, AURA_METRICS: '1', AURA_METRICS_TOKEN: SECRET })
    : loadConfig(BASE_ENV);
  return new HealthController(new MessageMetrics(metricsOn), config);
}

describe('GET /health', () => {
  /**
   * La sonde de base reste ouverte : un orchestrateur doit pouvoir dire si le
   * noeud repond sans porter de secret. Elle n'annonce que des versions, qui
   * doivent de toute facon concorder avec celles du client.
   */
  it('repond sans secret', () => {
    expect(controller(true).check().status).toBe('ok');
  });
});

/**
 * Les deux routes de mesure disent et defont des choses qui ne regardent que
 * l'exploitant : le nombre de matchs vivants, la cadence, la memoire — et,
 * pour la seconde, l'effacement de la fenetre en cours.
 *
 * Elles etaient ouvertes a qui sait former une requete HTTP. La lecture
 * renseigne qui prepare une charge ; l'ecriture aveugle la mesure **pendant**
 * qu'elle a lieu, ce qui est pire qu'une absence de mesure : le relevé obtenu
 * est plausible et faux.
 */
describe('routes de mesure, instrumentation allumee', () => {
  it('refuse une lecture sans en-tete', () => {
    expect(() => controller(true).metricsSnapshot()).toThrow(UnauthorizedException);
  });

  it('refuse une lecture avec le mauvais secret', () => {
    expect(() => controller(true).metricsSnapshot('Bearer autre-chose')).toThrow(
      UnauthorizedException,
    );
  });

  /** Le secret nu, sans `Bearer`, ne passe pas non plus. */
  it('refuse une lecture sans le prefixe attendu', () => {
    expect(() => controller(true).metricsSnapshot(SECRET)).toThrow(UnauthorizedException);
  });

  it('refuse une remise a zero sans secret', () => {
    expect(() => controller(true).resetMetrics()).toThrow(UnauthorizedException);
  });

  it('laisse passer le bon secret', () => {
    const health = controller(true);
    expect(health.metricsSnapshot(`Bearer ${SECRET}`).enabled).toBe(true);
    expect(health.resetMetrics(`Bearer ${SECRET}`)).toEqual({ reset: true });
  });

  /**
   * La remise a zero doit vraiment effacer : un test qui verifie l'acces sans
   * verifier l'effet passerait aussi si la route ne faisait rien.
   */
  it('efface bien la fenetre quand le secret est bon', () => {
    const metrics = new MessageMetrics(true);
    const socket = {};
    metrics.received(socket, 'ping');
    metrics.settleHandled(socket, 'ping');

    const config = loadConfig({ ...BASE_ENV, AURA_METRICS: '1', AURA_METRICS_TOKEN: SECRET });
    const health = new HealthController(metrics, config);

    const avant = health.metricsSnapshot(`Bearer ${SECRET}`);
    expect(avant.enabled && avant.messages.total.count).toBe(1);

    health.resetMetrics(`Bearer ${SECRET}`);

    const apres = health.metricsSnapshot(`Bearer ${SECRET}`);
    expect(apres.enabled && apres.messages.total.count).toBe(0);
  });
});

/**
 * Eteinte, il n'y a rien a proteger — le relevé est vide et la remise a zero
 * ne fait rien. Exiger un secret la obligerait a en configurer un sur chaque
 * serveur de production, c'est-a-dire a creer le secret qu'on cherche a ne pas
 * avoir a garder.
 */
describe('routes de mesure, instrumentation eteinte', () => {
  it('annonce franchement qu elle ne mesure rien', () => {
    expect(controller(false).metricsSnapshot()).toEqual({ enabled: false });
  });

  it('ne pretend pas avoir remis a zero', () => {
    expect(controller(false).resetMetrics()).toEqual({ reset: false });
  });
});
