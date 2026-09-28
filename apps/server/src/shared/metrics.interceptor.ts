import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MessageMetrics } from './metrics.js';

/**
 * Ferme la mesure d'un message entrant a la fin de son traitement (jalon M7).
 *
 * **Pourquoi un intercepteur et pas un minuteur pose dans la passerelle.**
 * Socket.IO execute ses intergiciels (`socket.use`) puis remet la distribution
 * du message a `process.nextTick` : le gestionnaire ne s'execute donc pas dans
 * la pile d'appel de l'intergiciel, et aucune astuce de `nextTick` ne permet
 * de le suivre de facon fiable — quand plusieurs paquets sont decodes dans la
 * meme lecture reseau, les tours s'entrelacent et la mesure attribue a l'un le
 * travail de l'autre. L'intercepteur, lui, encadre exactement le gestionnaire,
 * y compris quand celui-ci est asynchrone : l'observable se termine quand la
 * promesse est resolue.
 *
 * La correlation « arrivee / fin » est une file par connexion tenue par
 * `MessageMetrics` : les paquets d'une meme socket sont distribues dans
 * l'ordre ou ils sont arrives, donc le plus ancien non solde est toujours
 * celui qu'on vient de traiter.
 *
 * Eteint, il rend `next.handle()` sans rien y ajouter : aucun operateur RxJS,
 * aucun cout. C'est ce qui permet de l'enregistrer globalement sans reserve.
 */
@Injectable()
export class MessageTimingInterceptor implements NestInterceptor {
  constructor(@Inject(MessageMetrics) private readonly metrics: MessageMetrics) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Les routes REST passent aussi par ici : elles n'ont pas de connexion
    // temps reel a solder, et le critere du jalon ne parle que du temps reel.
    if (!this.metrics.enabled || context.getType() !== 'ws') {
      return next.handle();
    }

    const host = context.switchToWs();
    const connection: object = host.getClient();
    /**
     * Le nom de l'evenement, tel que NestJS le transmet.
     *
     * `WsProxy` l'ajoute en dernier argument de l'appel, et `getPattern` le
     * relit. Sans lui, il faudrait supposer que les gestionnaires se terminent
     * dans l'ordre ou leurs messages sont arrives — ce qui est faux des qu'un
     * gestionnaire attend : `queue:join` interroge Redis pendant que le `ping`
     * suivant a deja repondu.
     */
    const event = host.getPattern();

    return next.handle().pipe(
      tap({
        complete: () => {
          this.metrics.settleHandled(connection, event);
        },
        // Un gestionnaire qui echoue a quand meme consomme du temps serveur :
        // ne pas le solder laisserait sa trace en attente jusqu'a l'eviction.
        error: () => {
          this.metrics.settleHandled(connection, event);
        },
      }),
    );
  }
}
