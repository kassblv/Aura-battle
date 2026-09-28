import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CONFIG, metricsRequestedIn, type ServerConfig } from './config.js';
import { MessageMetrics } from './metrics.js';
import { MessageTimingInterceptor } from './metrics.interceptor.js';

/**
 * Mesure de charge, disponible partout (jalon M7).
 *
 * `@Global` pour la meme raison que la configuration et le journal : la sonde
 * de sante la publie, la passerelle l'alimente, le module match y declare ses
 * compteurs vivants. L'importer dans chacun n'apporterait aucune isolation.
 *
 * **L'intercepteur n'est enregistre que si l'on mesure.** Le laisser en place
 * en permanence avait le merite de mesurer exactement ce qui tourne, mais un
 * intercepteur global n'est jamais gratuit : NestJS construit une chaine RxJS
 * par message, meme quand l'intercepteur se contente de rendre `next.handle()`.
 * Or le relevé A/B de `docs/09` chiffre le cout de l'instrumentation complete a
 * **30 % de processeur** a mille matchs — a cette echelle, on ne fait pas payer
 * cela toute l'annee a un serveur de production pour un banc lance quatre fois.
 *
 * Le prix de ce choix est nomme plutot que caché : le banc mesure un serveur
 * **plus charge** que celui qui sert les joueurs, donc les percentiles publies
 * sont pessimistes. C'est le bon sens de l'erreur.
 */
@Global()
@Module({
  providers: [
    {
      provide: MessageMetrics,
      inject: [CONFIG],
      useFactory: (config: ServerConfig) => new MessageMetrics(config.metricsEnabled),
    },
    ...(metricsRequestedIn(process.env)
      ? [{ provide: APP_INTERCEPTOR, useClass: MessageTimingInterceptor }]
      : []),
  ],
  exports: [MessageMetrics],
})
export class MetricsModule {}
