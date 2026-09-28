import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './config.js';

/**
 * Configuration du serveur, disponible partout.
 *
 * `@Global` se justifie ici et nulle part ailleurs : la configuration est lue
 * et validee **une seule fois** au demarrage, elle ne change jamais ensuite, et
 * a peu pres chaque module en a besoin. L'alternative — l'importer dans chaque
 * module, y compris les modules dynamiques d'autres bibliotheques — n'apporte
 * aucune isolation reelle et multiplie les points d'oubli.
 */
@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [CONFIG],
})
export class ConfigModule {}
