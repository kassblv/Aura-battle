import { challengesForDay, dayIndexOf, type ChallengeDefinition } from '@aura/content';
import type { ChallengeRepository, Clock } from '../domain/ports.js';
import {
  advance,
  claimOutcome,
  type ClaimOutcome,
  type MatchContribution,
} from '../domain/progress.js';

/**
 * Les defis quotidiens, cote application.
 *
 * Il assemble trois choses qui ne se connaissent pas : le CATALOGUE
 * (`@aura/content`, de la donnee), les REGLES (`domain/progress.ts`, pures) et
 * la BASE (un port). Aucune des trois n'a besoin des deux autres pour etre
 * testee, et c'est ce qui permet de verifier une course entre deux
 * encaissements sans monter un Postgres.
 */

/** Un defi du jour, tel que le joueur le voit. */
export interface ChallengeView {
  readonly id: string;
  readonly name: string;
  readonly progress: number;
  readonly target: number;
  readonly reward: number;
  readonly done: boolean;
  readonly claimed: boolean;
}

export interface ChallengeDeps {
  readonly challenges: ChallengeRepository;
  readonly clock: Clock;
}

export class ChallengeService {
  constructor(private readonly deps: ChallengeDeps) {}

  /** Le numero du jour courant. Une seule lecture d'horloge par operation. */
  private today_(): number {
    return dayIndexOf(this.deps.clock.now().getTime());
  }

  async today(playerId: string): Promise<readonly ChallengeView[]> {
    const day = this.today_();
    const stored = await this.deps.challenges.read(playerId, day);
    const byId = new Map(stored.map((row) => [row.challengeId, row]));

    return challengesForDay(day).map((challenge) => {
      const row = byId.get(challenge.id);
      const progress = row?.progress ?? 0;
      return {
        id: challenge.id,
        name: challenge.name.fr,
        progress,
        target: challenge.target,
        reward: challenge.reward,
        done: progress >= challenge.target,
        claimed: row?.claimed ?? false,
      };
    });
  }

  /**
   * Enregistre ce qu'une partie a rapporte.
   *
   * Seuls les defis du JOUR avancent : la progression d'hier appartient a
   * hier, et un joueur qui ouvre le jeu le lendemain doit retrouver trois
   * defis a zero.
   */
  async recordMatch(playerId: string, contribution: MatchContribution): Promise<void> {
    const day = this.today_();
    const stored = await this.deps.challenges.read(playerId, day);
    const byId = new Map(stored.map((row) => [row.challengeId, row]));

    const entries: { challengeId: string; progress: number }[] = [];
    for (const challenge of challengesForDay(day)) {
      const before = byId.get(challenge.id)?.progress ?? 0;
      const after = advance(challenge, before, contribution);
      // Rien n'a bouge : on n'ecrit pas. Sans ce filtre, chaque match de
      // chaque joueur creerait trois lignes a zero — une table qui grossit de
      // tout ce qui ne s'est pas passe.
      if (after !== before) entries.push({ challengeId: challenge.id, progress: after });
    }

    if (entries.length > 0) await this.deps.challenges.write(playerId, day, entries);
  }

  /**
   * Encaisse la recompense.
   *
   * Deux gardes, et la seconde ne peut pas vivre ici : la regle pure dit si le
   * defi est fini et pas deja paye, mais entre sa lecture et l'ecriture un
   * second onglet a le temps de passer. C'est la base qui tranche, et le
   * service **croit son refus** plutot que sa propre lecture.
   */
  async claim(playerId: string, challengeId: string): Promise<ClaimOutcome> {
    const day = this.today_();
    const today: readonly ChallengeDefinition[] = challengesForDay(day);
    const stored = await this.deps.challenges.read(playerId, day);

    const outcome = claimOutcome(today, stored, challengeId);
    if (outcome.status !== 'granted') return outcome;

    const granted = await this.deps.challenges.claim(playerId, day, challengeId, outcome.reward);
    return granted ? outcome : { status: 'already-claimed' };
  }
}
