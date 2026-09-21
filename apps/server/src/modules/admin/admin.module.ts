import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { CONFIG, type ServerConfig } from '../../shared/config.js';
import { RedisModule } from '../../shared/redis.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminController } from './adapters/admin.controller.js';
import { RealAdminProbes } from './adapters/admin-probes.js';
import { AdminStatusService } from './application/admin-status.service.js';
import { createErrorLog } from './domain/error-log.js';

/**
 * Le panneau d'administration (docs/10).
 *
 * `AuthModule` n'est importe que pour `PrismaService` : le panneau
 * n'authentifie PAS par jeton de joueur. Son secret vit dans l'environnement,
 * hors de la base — un drapeau d'administrateur sur `Player` mettrait le
 * privilege le plus eleve du systeme dans la meme ligne qu'un compte invite
 * que n'importe quel navigateur peut creer.
 */
/**
 * L'instant de construction de l'image, lu une fois.
 *
 * Le fichier est grave par le Dockerfile et ne change jamais : le relire a
 * chaque appel du panneau serait une lecture disque par rafraichissement, pour
 * une valeur constante. Absent en developpement — on rend `null`, et le
 * panneau dit « inconnue » plutot que d'inventer.
 */
const BUILT_AT: string | null = (() => {
  try {
    const raw = readFileSync('/repo/.build-time', 'utf8').trim();
    return raw === '' ? null : raw;
  } catch {
    return null;
  }
})();

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [AdminController],
  providers: [
    RealAdminProbes,
    {
      provide: AdminStatusService,
      inject: [RealAdminProbes, CONFIG],
      useFactory: (probes: RealAdminProbes, config: ServerConfig) =>
        new AdminStatusService({
          probes,
          errors: createErrorLog(),
          now: () => Date.now(),
          uptimeSeconds: () => Math.round(process.uptime()),
          commit: config.commit,
          builtAt: () => BUILT_AT,
        }),
    },
  ],
  exports: [AdminStatusService],
})
export class AdminModule {}
