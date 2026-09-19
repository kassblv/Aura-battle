import { Controller, Get } from '@nestjs/common';
import { CONTENT_VERSION } from '@aura/content';
import { PROTOCOL_VERSION } from '@aura/protocol';
import { RULES_VERSION } from '@aura/rules';

/**
 * Sonde de sante.
 *
 * Elle annonce les trois versions qui doivent concorder entre le serveur et le
 * client. Un noeud qui sert une version de regles differente des autres est un
 * incident : un match ne doit jamais melanger deux versions (docs/03).
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): {
    status: 'ok';
    protocolVersion: string;
    rulesVersion: string;
    contentVersion: string;
  } {
    return {
      status: 'ok',
      protocolVersion: PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      contentVersion: CONTENT_VERSION,
    };
  }
}
