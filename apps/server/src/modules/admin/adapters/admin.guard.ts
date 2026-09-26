import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AdminGate } from '../application/admin-gate.js';

/**
 * La garde de toutes les routes d'API du panneau (docs/10, ADR 0018).
 *
 * `404` sans `ADMIN_TOKEN` (le panneau n'existe pas), `429` apres dix essais
 * rates dans la minute depuis la meme adresse, `401` sans le bon secret. La
 * decision vit dans `AdminGate`, qui se teste sans serveur.
 *
 * L'adresse est `request.ip` : derriere Traefik, `TRUST_PROXY` en fait celle
 * du client plutot que celle du mandataire (voir `shared/config.ts`).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(@Inject(AdminGate) private readonly gate: AdminGate) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    switch (this.gate.check(typeof header === 'string' ? header : undefined, request.ip)) {
      case 'OK':
        return true;
      case 'DISABLED':
        throw new NotFoundException({ code: 'NOT_FOUND' });
      case 'RATE_LIMITED':
        throw new HttpException(
          { code: 'TOO_MANY_ATTEMPTS', message: 'trop d essais, attends une minute' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'UNAUTHORIZED':
        throw new UnauthorizedException({ code: 'UNAUTHORIZED' });
    }
  }
}
