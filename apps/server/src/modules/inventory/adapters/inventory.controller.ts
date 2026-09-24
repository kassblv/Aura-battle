import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import {
  parseInventoryBuyRequest,
  parseInventoryEquipRequest,
  type InventoryState,
  type LoadoutPayload,
} from '@aura/protocol';
import { readBearer } from '../../auth/application/bearer.js';
import type { AccessTokenVerifier } from '../../auth/application/socket-auth.js';
import type { LoadoutData } from '../domain/ports.js';
import {
  InventoryError,
  InventoryService,
  type InventoryFailure,
} from '../application/inventory.js';

/**
 * Routes de l'inventaire (jalon M8).
 *
 * En HTTP et non par la socket : la boutique et le vestiaire s'utilisent hors
 * match, et forcer une connexion temps reel pour essayer une tenue serait
 * absurde.
 *
 * Les trois routes sont authentifiees — un inventaire est celui de quelqu'un.
 * Le jeton est lu ici plutot que par une garde globale, comme dans
 * `auth.controller.ts` : la garde y fermerait aussi les routes qu'on appelle
 * justement sans jeton.
 */

/** Ce que chaque refus du domaine vaut en HTTP. */
const STATUS: Readonly<Record<InventoryFailure, 'not-found' | 'conflict' | 'forbidden' | 'bad'>> =
  Object.freeze({
    UNKNOWN_ITEM: 'not-found',
    ALREADY_OWNED: 'conflict',
    NOT_PURCHASABLE: 'forbidden',
    UNAVAILABLE: 'forbidden',
    INSUFFICIENT_FUNDS: 'forbidden',
    NOT_OWNED: 'forbidden',
    WRONG_SLOT: 'bad',
  });

/**
 * Retire les cles dont la valeur est indefinie.
 *
 * `exactOptionalPropertyTypes` distingue « absent » de « present et
 * indefini » — et pour un equipement, les deux veulent dire la meme chose :
 * cet emplacement est vide. Zod rend la seconde forme, le domaine attend la
 * premiere. Plutot que d'assouplir le domaine pour un detail de compilation,
 * on nettoie a la frontiere, qui est exactement l'endroit d'un adaptateur.
 */
function toLoadout(payload: LoadoutPayload): LoadoutData {
  const out: LoadoutData = {};
  for (const [slot, value] of Object.entries(payload)) {
    if (value !== undefined) (out as Record<string, unknown>)[slot] = value;
  }
  return out;
}

@Controller('inventory')
export class InventoryController {
  // Jetons explicites : esbuild n'emet pas `design:paramtypes`.
  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject('ACCESS_TOKEN_VERIFIER') private readonly verifier: AccessTokenVerifier,
  ) {}

  @Get()
  async read(@Headers('authorization') authorization: string | undefined): Promise<InventoryState> {
    const playerId = await this.requirePlayer(authorization);
    const inventory = await this.inventory.read(playerId);
    return {
      wallet: inventory.wallet,
      owned: [...inventory.owned],
      loadout: inventory.loadout ?? {},
    };
  }

  /**
   * Achete un objet.
   *
   * La requete ne porte **que** l'identifiant : le prix vient du catalogue,
   * jamais du client. C'est la regle d'or n°1 appliquee a la boutique.
   */
  @Post('buy')
  async buy(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<InventoryState> {
    const playerId = await this.requirePlayer(authorization);
    const parsed = parseInventoryBuyRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }

    await this.run(() => this.inventory.buy(playerId, parsed.data.itemId));
    // On rend l'etat complet plutot qu'un accuse de reception : le client
    // n'a alors rien a recalculer de son cote, donc rien a faire diverger.
    return this.read(authorization);
  }

  @Put('loadout')
  async equip(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<InventoryState> {
    const playerId = await this.requirePlayer(authorization);
    const parsed = parseInventoryEquipRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }

    await this.run(() => this.inventory.equip(playerId, toLoadout(parsed.data)));
    return this.read(authorization);
  }

  private async requirePlayer(authorization: string | undefined): Promise<string> {
    const token = readBearer(authorization);
    if (token === null) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'jeton absent' });
    }
    try {
      return (await this.verifier.verify(token)).sub;
    } catch {
      // Signature, expiration, jeton forge : meme reponse pour les trois.
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'session invalide' });
    }
  }

  /**
   * Traduit un refus du domaine en reponse HTTP.
   *
   * Le code renvoye est celui du domaine, pas une phrase : c'est le client qui
   * choisit les mots, et il les choisit en francais. Un message traduit ici
   * serait un deuxieme endroit ou ecrire la meme chose.
   */
  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (cause) {
      if (!(cause instanceof InventoryError)) throw cause;
      const payload = { code: cause.reason, message: cause.reason };
      switch (STATUS[cause.reason]) {
        case 'not-found':
          throw new NotFoundException(payload);
        case 'conflict':
          throw new ConflictException(payload);
        case 'bad':
          throw new BadRequestException(payload);
        default:
          throw new ForbiddenException(payload);
      }
    }
  }
}
