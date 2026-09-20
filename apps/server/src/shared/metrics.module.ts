import { Global, Module } from '@nestjs/common';
import { CONFIG, type ServerConfig } from './config.js';
import { MessageMetrics } from './metrics.js';

/**
 * Mesure de charge, disponible partout (jalon M7).
 *
 * `@Global` pour la meme raison que la configuration et le journal : la sonde
 * de sante la publie, la passerelle l'alimente, le module match y declare ses
 * compteurs vivants. L'importer dans chacun n'apporterait aucune isolation.
 *
 * L'intercepteur est enregistre **toujours**, allume ou non : il rend
 * `next.handle()` inchange quand la mesure est eteinte, et un enregistrement
 * conditionnel ferait que le chemin mesure ne soit pas tout a fait celui qui
 * tourne en production.
 */
@Global()
@Module({
  providers: [
    {
      provide: MessageMetrics,
      inject: [CONFIG],
      useFactory: (config: ServerConfig) => new MessageMetrics(config.metricsEnabled),
    },
  ],
  exports: [MessageMetrics],
})
export class MetricsModule {}
