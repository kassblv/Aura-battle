import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const validEnv = {
  DATABASE_URL: 'postgresql://aura:aura@localhost:5432/aura',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'un-secret-assez-long',
} satisfies NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('applique les valeurs par defaut', () => {
    const config = loadConfig(validEnv);
    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.jwtAccessTtl).toBe(900);
  });

  it('convertit le port en nombre', () => {
    expect(loadConfig({ ...validEnv, PORT: '8080' }).port).toBe(8080);
  });

  it('refuse un environnement sans base de donnees', () => {
    const { DATABASE_URL: _omis, ...sansBase } = validEnv;
    expect(() => loadConfig(sansBase)).toThrow(ConfigError);
  });

  it('refuse un secret JWT trop court', () => {
    expect(() => loadConfig({ ...validEnv, JWT_SECRET: 'court' })).toThrow(/JWT_SECRET/);
  });

  it('renvoie un objet gele', () => {
    expect(Object.isFrozen(loadConfig(validEnv))).toBe(true);
  });
});

describe('corsOrigins', () => {
  const base = {
    DATABASE_URL: 'postgresql://a',
    REDIS_URL: 'redis://a',
    JWT_SECRET: 'un-secret-assez-long',
  };

  it('n autorise aucune origine etrangere par defaut', () => {
    // Le bon reglage quand le client est servi par le meme hote que l'API.
    expect(loadConfig({ ...validEnv }).corsOrigins).toEqual([]);
  });

  it('lit une liste separee par des virgules', () => {
    expect(
      loadConfig({ ...base, CORS_ORIGINS: 'https://aura.app,https://staging.aura.app' })
        .corsOrigins,
    ).toEqual(['https://aura.app', 'https://staging.aura.app']);
  });

  it('tolere les espaces et les virgules en trop', () => {
    // Une variable d'environnement se recopie a la main : elle arrive sale.
    expect(
      loadConfig({ ...base, CORS_ORIGINS: ' https://a.app , , https://b.app ,' }).corsOrigins,
    ).toEqual(['https://a.app', 'https://b.app']);
  });
});

describe('databasePoolMax', () => {
  /**
   * Le defaut du pilote `pg` est dix, et dix n'est la mesure de rien. Un
   * serveur qui l'herite en silence decouvre la decision le jour ou des
   * matchs n'arrivent plus a s'ecrire, sans que la moindre latence ne bouge.
   */
  it('vaut vingt par defaut, pas le defaut du pilote', () => {
    expect(loadConfig({ ...validEnv }).databasePoolMax).toBe(20);
  });

  it('se regle par l environnement', () => {
    expect(loadConfig({ ...validEnv, DATABASE_POOL_MAX: '40' }).databasePoolMax).toBe(40);
  });

  it('refuse un bassin vide', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_POOL_MAX: '0' })).toThrow(ConfigError);
  });
});

/**
 * `/health/metrics` dit combien de matchs vivent sur le noeud et a quelle
 * cadence ; `/health/metrics/reset` efface la fenetre en cours. Les deux
 * etaient ouvertes a qui sait former une requete HTTP : la premiere renseigne
 * qui prepare une charge, la seconde aveugle la mesure pendant qu'elle a lieu.
 *
 * Le couple « mesure allumee, aucun secret » est donc refuse **au demarrage**,
 * pas tolere en silence : un serveur qui ne demarre pas se remarque, une route
 * ouverte non.
 */
describe('secret des routes de mesure', () => {
  const base = {
    DATABASE_URL: 'postgresql://a',
    REDIS_URL: 'redis://a',
    JWT_SECRET: 'un-secret-assez-long',
  };

  it('refuse de demarrer avec la mesure allumee et aucun secret', () => {
    expect(() => loadConfig({ ...base, AURA_METRICS: '1' })).toThrow(/AURA_METRICS_TOKEN/);
  });

  it('accepte la mesure allumee quand le secret est la', () => {
    const config = loadConfig({ ...base, AURA_METRICS: '1', AURA_METRICS_TOKEN: 'secret' });
    expect(config.metricsEnabled).toBe(true);
    expect(config.metricsToken).toBe('secret');
  });

  /** Eteinte, il n'y a rien a proteger : le secret n'est pas exige. */
  it('n exige aucun secret quand la mesure est eteinte', () => {
    expect(loadConfig(base).metricsToken).toBe('');
    expect(loadConfig(base).metricsEnabled).toBe(false);
  });
});

describe('client statique', () => {
  /*
    Vide par defaut, et ce defaut est un choix : en developpement c est Vite
    qui sert le client, sur un autre port. En production la variable designe le
    build, et le serveur sert les deux depuis la meme origine — ce que le
    commentaire de `corsOrigins` suppose deja.
  */
  it('ne sert rien par defaut', () => {
    expect(loadConfig(validEnv).clientDir).toBe('');
  });

  it('retient le dossier du build', () => {
    expect(loadConfig({ ...validEnv, CLIENT_DIR: '/app/client' }).clientDir).toBe('/app/client');
  });

  it('traite un dossier vide comme une absence', () => {
    expect(loadConfig({ ...validEnv, CLIENT_DIR: '   ' }).clientDir).toBe('');
  });
});
