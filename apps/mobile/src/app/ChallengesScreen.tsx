import type { JSX } from 'react';
import type { ChallengeView } from '@aura/protocol';

/**
 * Les defis du jour.
 *
 * Trois colonnes, une par defi : en paysage la largeur ne manque pas et la
 * hauteur si. Empiles, trois barres de progression et leurs boutons
 * debordaient la ou trois colonnes tiennent sans rien faire defiler.
 *
 * Aucun calcul ici. La progression, la cible et la recompense viennent toutes
 * de la meme reponse du serveur : mesurees de deux cotes, elles finiraient par
 * se contredire — une barre pleine sur un defi qu il refuse d encaisser.
 */

export interface ChallengesProps {
  readonly challenges: readonly ChallengeView[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly synced: boolean;
  readonly onClaim: (challengeId: string) => void;
  readonly onClose: () => void;
}

export function ChallengesScreen({
  challenges,
  busy,
  error,
  synced,
  onClaim,
  onClose,
}: ChallengesProps): JSX.Element {
  return (
    <section className="sheet sheet--wide sheet--short" aria-label="Défis du jour">
      <header className="sheet__head">
        <h2>Défis du jour</h2>
        <button type="button" className="mini" onClick={onClose}>
          Fermer
        </button>
      </header>

      {error !== null && <p className="sheet__note sheet__note--bad">{error}</p>}

      {/*
        Hors ligne on le DIT, plutot que de montrer une liste vide.
        « Rien aujourd'hui » et « je n'ai pas pu demander » sont deux choses
        differentes, et seul le second se repare en attendant le reseau.
      */}
      {!synced && challenges.length === 0 && (
        <p className="sheet__note">Défis indisponibles hors ligne. Le solo reste jouable.</p>
      )}

      {challenges.length > 0 && (
        <ul className="quests">
          {challenges.map((challenge) => (
            <li key={challenge.id} className="quest" data-done={challenge.done}>
              <b className="quest__name">{challenge.name}</b>

              <span
                className="quest__bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={challenge.target}
                aria-valuenow={challenge.progress}
                aria-label={challenge.name}
              >
                <i style={{ width: `${percent(challenge)}%` }} />
              </span>

              <small className="quest__count">
                {challenge.progress} / {challenge.target}
              </small>

              {challenge.claimed ? (
                <span className="quest__done">encaissé</span>
              ) : (
                <button
                  type="button"
                  className="quest__claim"
                  disabled={!challenge.done || busy}
                  onClick={() => {
                    onClaim(challenge.id);
                  }}
                >
                  {/* Le montant est visible AVANT d'avoir fini : c'est lui qui
                      donne envie de finir. */}
                  <span aria-hidden="true">◈</span> {challenge.reward}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/*
        « En duel en ligne » n'est pas un detail : le serveur ne voit jamais
        une partie solo, donc elle ne fait rien avancer. Le taire laisserait
        un joueur enchainer des solos en regardant des compteurs immobiles et
        conclure a une panne — alors que c'est la regle, et qu'elle decoule de
        « valides cote serveur » : un resultat annonce par le client rendrait
        le defi declaratif.
      */}
      <p className="sheet__note">
        La progression se compte côté serveur, à la fin de chaque manche, en duel en ligne. Tout
        repart à zéro à minuit.
      </p>
    </section>
  );
}

/** Part remplie de la barre, bornee : une barre a 140 % se lit comme un bogue. */
function percent(challenge: ChallengeView): number {
  if (challenge.target <= 0) return 0;
  return Math.min(100, Math.round((challenge.progress / challenge.target) * 100));
}
