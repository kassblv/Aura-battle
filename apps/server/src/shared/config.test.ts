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
