import type { JSX } from 'react';
import type { QualitySetting, QualityTier } from '../platform/quality.js';
import { AccountSection, type AccountSectionProps } from './AccountSection.jsx';
import { qualityNote, qualityOptions } from './settings.js';

/**
 * Les reglages.
 *
 * Un seul sujet pour l instant — la qualite graphique — mais un ecran a lui,
 * pas une ligne perdue au bas du profil : c est l endroit ou le joueur vient
 * quand quelque chose ne va pas, et il doit le trouver du premier coup.
 *
 * Les boutons sont un groupe radio, pas une liste de boutons : un palier
 * choisi en remplace un autre, et un lecteur d ecran doit l entendre.
 */

export interface SettingsProps {
  readonly setting: QualitySetting;
  /** Le palier reellement applique, qui peut differer du reglage en `auto`. */
  readonly tier: QualityTier;
  readonly onQuality: (setting: QualitySetting) => void;
  readonly onClose: () => void;
  readonly account: AccountSectionProps;
}

export function SettingsScreen({
  setting,
  tier,
  onQuality,
  onClose,
  account,
}: SettingsProps): JSX.Element {
  return (
    <section className="sheet sheet--wide" aria-label="Réglages">
      <header className="sheet__head">
        <h2>Réglages</h2>
        <button type="button" className="mini" onClick={onClose}>
          Fermer
        </button>
      </header>

      {/*
        Deux colonnes, sur toute la largeur.

        En paysage l'ecran est large et bas : empiler deux sections dans un
        panneau de droite les faisait deborder de la hauteur — la seule
        ressource rare — pendant que la moitie gauche ne servait a rien. Cote
        a cote, chaque section tient sans defilement, et les deux restent dans
        les arcs de pouce plutot qu'au centre, ou personne n'a de doigt.
      */}
      <div className="sheet__cols">
        <div className="sheet__col">
          <h3>Qualité graphique</h3>

          <div className="choices" role="radiogroup" aria-label="Qualité graphique">
            {qualityOptions(setting).map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={option.selected}
                className={option.selected ? 'choice choice--on' : 'choice'}
                onClick={() => {
                  onQuality(option.id);
                }}
              >
                <b>{option.label}</b>
                <small>{option.hint}</small>
              </button>
            ))}
          </div>

          <p className="sheet__note">{qualityNote(setting, tier)}</p>
        </div>

        <AccountSection {...account} />
      </div>
    </section>
  );
}
