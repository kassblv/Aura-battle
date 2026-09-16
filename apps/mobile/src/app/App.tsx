import { PROTOCOL_VERSION } from '@aura/protocol';
import { CONTENT_VERSION } from '@aura/content';
import { RULES_VERSION } from '@aura/rules';
import { resolveServerUrl } from '../net/serverUrl.js';

/**
 * Ecran de demarrage provisoire.
 *
 * Il ne sert qu'a verifier que la chaine complete tient debout : les trois
 * packages partages se resolvent, et le client sait quel serveur joindre depuis
 * l'appareil qui l'affiche. Les vrais ecrans arrivent au jalon M4.
 */
export function App(): React.JSX.Element {
  const serverUrl = resolveServerUrl(import.meta.env.VITE_SERVER_URL, window.location.hostname);

  return (
    <main className="boot">
      <h1 className="boot__title">Aura Battle</h1>
      <p className="boot__tagline">Duels d&apos;aura — jalon M0</p>
      <dl className="boot__grid">
        <dt>Regles</dt>
        <dd>{RULES_VERSION}</dd>
        <dt>Protocole</dt>
        <dd>v{PROTOCOL_VERSION}</dd>
        <dt>Contenu</dt>
        <dd>{CONTENT_VERSION}</dd>
        <dt>Serveur</dt>
        <dd>{serverUrl}</dd>
      </dl>
    </main>
  );
}
