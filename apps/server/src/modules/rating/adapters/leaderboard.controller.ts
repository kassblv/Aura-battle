import { Controller, Get, Headers, Inject, UnauthorizedException } from '@nestjs/common';
import type { LeaderboardPayload } from '@aura/protocol';
import { readBearer } from '../../auth/application/bearer.js';
import type { AccessTokenVerifier } from '../../auth/application/socket-auth.js';
import { LEADERBOARD_TOP, NEIGHBOURS, leaderboardView } from '../domain/leaderboard.js';
import type { LeaderboardReader } from '../domain/ports.js';

/**
 * Le classement general (docs/05, derniere case de M5).
 *
 * Authentifie, et pas par pudeur : le classement est public, mais la ligne
 * « ou suis-je » ne peut se calculer que pour quelqu'un. Sans jeton, on ne
 * sait pas de qui il s'agit — et un classement sans sa propre place ne
 * repond pas a la question qu'on se pose en l'ouvrant.
 */
@Controller('leaderboard')
export class LeaderboardController {
  // Jetons explicites : esbuild n'emet pas `design:paramtypes`.
  constructor(
    @Inject('LEADERBOARD_READER') private readonly reader: LeaderboardReader,
    @Inject('ACCESS_TOKEN_VERIFIER') private readonly verifier: AccessTokenVerifier,
  ) {}

  @Get()
  async read(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<LeaderboardPayload> {
    const playerId = await this.requirePlayer(authorization);
    const now = Date.now();

    /*
      Les deux lectures partent ensemble.

      Elles sont independantes — la tete et le voisinage — et les enchainer
      doublerait l'attente pour rien. Un match qui s'acheve entre les deux
      decalerait au pire une ligne d'un rang, ce qui ne se voit pas ; le
      voisinage, lui, est numerote en UNE requete, justement pour qu'on ne
      puisse pas etre absent de son propre voisinage.
    */
    const [top, around] = await Promise.all([
      this.reader.top(LEADERBOARD_TOP, now),
      this.reader.around(playerId, NEIGHBOURS, now),
    ]);

    const view = leaderboardView({
      top,
      around: around?.rows ?? [],
      me: around?.me ?? null,
    });

    // Recopie en tableaux mutables : le domaine rend du `readonly`, le schema
    // du protocole decrit ce qui part sur le fil. Recopier ici est le travail
    // d'un adaptateur ; assouplir l'un des deux pour eviter trois lignes
    // reviendrait a laisser le fil dicter sa forme au domaine.
    return { top: [...view.top], around: [...view.around], me: view.me };
  }

  private async requirePlayer(authorization: string | undefined): Promise<string> {
    const token = readBearer(authorization);
    if (token === null) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'jeton absent' });
    }
    try {
      return (await this.verifier.verify(token)).sub;
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'session invalide' });
    }
  }
}
