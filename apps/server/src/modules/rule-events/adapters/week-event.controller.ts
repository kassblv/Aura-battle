import {
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { weekEventSchema, type WeekEvent } from '@aura/protocol';
import { readBearer } from '../../auth/application/bearer.js';
import type { AccessTokenVerifier } from '../../auth/application/socket-auth.js';
import { RuleEventsService } from '../application/rule-events.service.js';

/**
 * L'evenement de la semaine, tel que le serveur l'appliquera a l'ouverture
 * d'une partie rapide (`GET /events/week`, protocole 2.7.0).
 *
 * Authentifiee comme les autres routes du joueur, bien qu'elle ne revele rien
 * — la variante est annoncee a tout le monde a l'accueil : une route de plus
 * ouverte a qui sait former une requete est une route de plus a surveiller, et
 * le client l'appelle deja avec sa session. Aucune lecture en base : la
 * reponse vient du cache du service.
 */
@Controller('events')
export class WeekEventController {
  // Jetons explicites : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(
    @Inject(RuleEventsService) private readonly events: RuleEventsService,
    @Inject('ACCESS_TOKEN_VERIFIER') private readonly verifier: AccessTokenVerifier,
  ) {}

  @Get('week')
  @Header('cache-control', 'no-store')
  async week(@Headers('authorization') authorization?: string): Promise<WeekEvent> {
    const token = readBearer(authorization);
    if (token === null) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'jeton absent' });
    }
    try {
      await this.verifier.verify(token);
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'session invalide' });
    }
    // Valide en sortie : une variante au format refuse par le protocole ferait
    // ecarter la reponse par le client, en silence.
    const checked = weekEventSchema.safeParse(this.events.playerWeek());
    if (!checked.success) throw new InternalServerErrorException({ code: 'INTERNAL' });
    return checked.data;
  }
}
