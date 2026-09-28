import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  HttpStatus,
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
import { SystemClock } from '../../../shared/clock.js';
import { KeyedSerializerFullError } from '../../../shared/keyed-serializer.js';
import type { Clock, LoadoutData, PlayerInventory } from '../domain/ports.js';
import {
  InventoryError,
  InventoryService,
  type InventoryFailure,
} from '../application/inventory.js';
import { InventoryRateLimit, type InventoryRoute } from '../application/inventory-rate-limit.js';

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
 *
 * Les trois routes sont limitees en debit PAR JOUEUR (`InventoryRateLimit`),
 * apres l'authentification et avant tout le reste : un corps invalide ou un
 * achat refuse coute un jeton comme les autres, sinon la boucle passerait par
 * la. Le refus est un 429 `RATE_LIMITED`, le code que la socket de match
 * emploie deja. Meme refus quand la file d'ecritures du joueur est pleine
 * (`INVENTORY_WRITE_QUEUE`) : le debit borne le rythme, pas la file.
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

/** Le refus « ralentis » : un seau vide, ou une file d'ecritures pleine. */
function rateLimited(): HttpException {
  return new HttpException(
    { code: 'RATE_LIMITED', message: 'RATE_LIMITED' },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/** Ce que lit le client : l'inventaire complet, jamais un simple accuse. */
function toState(inventory: PlayerInventory): InventoryState {
  return {
    wallet: inventory.wallet,
    owned: [...inventory.owned],
    loadout: inventory.loadout ?? {},
  };
}

@Controller('inventory')
export class InventoryController {
  // Jetons explicites : esbuild n'emet pas `design:paramtypes`.
  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject('ACCESS_TOKEN_VERIFIER') private readonly verifier: AccessTokenVerifier,
    @Inject(InventoryRateLimit) private readonly rateLimit: InventoryRateLimit,
    @Inject(SystemClock) private readonly clock: Clock,
  ) {}

  @Get()
  async read(@Headers('authorization') authorization: string | undefined): Promise<InventoryState> {
    const playerId = await this.requirePlayer(authorization);
    // La lecture aussi : trois requetes par appel, c'etait la boucle la moins
    // chere pour occuper le pool Postgres.
    this.throttle('read', playerId);
    return toState(await this.inventory.read(playerId));
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
    this.throttle('buy', playerId);
    const parsed = parseInventoryBuyRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }

    // On rend l'etat complet plutot qu'un accuse de reception : le client
    // n'a alors rien a recalculer de son cote, donc rien a faire diverger.
    // L'etat que le service a lu et ecrit, pas une relecture de la base.
    return toState(
      await this.run(() => this.inventory.buy(playerId, parsed.data.itemId, parsed.data.currency)),
    );
  }

  @Put('loadout')
  async equip(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<InventoryState> {
    const playerId = await this.requirePlayer(authorization);
    this.throttle('loadout', playerId);
    const parsed = parseInventoryEquipRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }

    return toState(await this.run(() => this.inventory.equip(playerId, toLoadout(parsed.data))));
  }

  /**
   * Refuse en 429 le joueur qui a epuise son seau sur cette route.
   *
   * Le code, pas une phrase : c'est le client qui choisit les mots. Le temps
   * vient de l'horloge du serveur, jamais de la requete.
   */
  private throttle(route: InventoryRoute, playerId: string): void {
    if (this.rateLimit.allow(route, playerId, this.clock.now().getTime())) return;
    throw rateLimited();
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
  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (cause) {
      // File d'ecritures du joueur pleine : meme refus qu'un seau vide. Pour
      // le client, c'est la meme consigne — ralentir et reessayer.
      if (cause instanceof KeyedSerializerFullError) throw rateLimited();
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
