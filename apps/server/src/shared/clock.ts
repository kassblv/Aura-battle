import { Injectable } from '@nestjs/common';
import type { Clock } from '../modules/auth/domain/ports.js';

/**
 * Horloge systeme.
 *
 * Elle existe pour une seule raison : que tout le reste du code recoive le
 * temps au lieu de le lire. Un service qui appelle `new Date()` directement ne
 * peut pas etre teste sur l'expiration d'un jeton sans attendre trente jours.
 */
@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
