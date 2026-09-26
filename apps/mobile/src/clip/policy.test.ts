import { describe, expect, it } from 'vitest';
import { VERDICT_PANEL_AT_MS } from '../arena/round.js';
import {
  CLIP_LATEST_START_MS,
  CLIP_STOP_AT_MS,
  clipPolicy,
  INITIAL_CLIP_POLICY,
  type ClipCommand,
  type ClipObservation,
  type ClipPolicyState,
} from './policy.js';

type Last = ClipObservation['last'];

const obs = (
  phase: ClipObservation['phase'],
  round: number,
  inPhaseMs: number,
  last: Last = null,
): ClipObservation => ({ phase, round, inPhaseMs, last });

/** Rejoue une suite d observations et rend toutes les commandes emises. */
function run(
  steps: readonly ClipObservation[],
  from: ClipPolicyState = INITIAL_CLIP_POLICY,
): { state: ClipPolicyState; commands: ClipCommand[] } {
  let state = from;
  const commands: ClipCommand[] = [];
  for (const step of steps) {
    const next = clipPolicy(state, step);
    state = next.state;
    commands.push(...next.commands);
  }
  return { state, commands };
}

const won = (round: number): Last => ({ round, winner: 'moi' });
const lost = (round: number): Last => ({ round, winner: 'adversaire' });

describe('clipPolicy', () => {
  it('s arrete peu apres le panneau de verdict', () => {
    expect(CLIP_STOP_AT_MS).toBe(VERDICT_PANEL_AT_MS + 900);
  });

  it('enregistre une manche gagnee, du debut de la revelation au verdict', () => {
    const { commands } = run([
      obs('choice', 1, 3_000),
      obs('reveal', 1, 16, won(1)),
      obs('reveal', 1, 1_500, won(1)),
      obs('reveal', 1, CLIP_STOP_AT_MS, won(1)),
    ]);
    expect(commands).toEqual(['start', 'stop']);
  });

  it('n enregistre ni une manche perdue ni une manche nulle', () => {
    expect(run([obs('reveal', 1, 16, lost(1))]).commands).toEqual([]);
    expect(run([obs('reveal', 1, 16, { round: 1, winner: null })]).commands).toEqual([]);
  });

  it('ne demarre pas une revelation deja entamee : le clip n aurait pas ses cartes', () => {
    expect(run([obs('reveal', 1, CLIP_LATEST_START_MS, won(1))]).commands).toEqual([]);
    expect(run([obs('reveal', 1, CLIP_LATEST_START_MS - 1, won(1))]).commands).toEqual(['start']);
  });

  it('ne relance pas la meme manche a chaque observation', () => {
    const { commands } = run([
      obs('reveal', 1, 10, won(1)),
      obs('reveal', 1, CLIP_STOP_AT_MS, won(1)),
      obs('reveal', 1, CLIP_STOP_AT_MS + 100, won(1)),
      obs('recharge', 2, 0, won(1)),
    ]);
    expect(commands).toEqual(['start', 'stop']);
  });

  it('garde ce qui a ete filme si la revelation finit plus tot que prevu', () => {
    const { commands } = run([obs('reveal', 1, 10, won(1)), obs('ended', 1, 0, won(1))]);
    expect(commands).toEqual(['start', 'stop']);
  });

  it('filme chaque nouvelle manche gagnee : la derniere remplace la precedente', () => {
    const { commands } = run([
      obs('reveal', 1, 10, won(1)),
      obs('reveal', 1, CLIP_STOP_AT_MS, won(1)),
      obs('intro', 2, 0, won(1)),
      obs('reveal', 2, 10, lost(2)),
      obs('intro', 3, 0, lost(2)),
      obs('reveal', 3, 10, won(3)),
      obs('reveal', 3, CLIP_STOP_AT_MS, won(3)),
    ]);
    expect(commands).toEqual(['start', 'stop', 'start', 'stop']);
  });

  it('abandonne le clip quand un nouveau match commence apres la fin', () => {
    const { commands } = run([
      obs('reveal', 1, 10, won(1)),
      obs('reveal', 1, CLIP_STOP_AT_MS, won(1)),
      obs('ended', 3, 0, won(3)),
      obs('intro', 1, 0, null),
    ]);
    expect(commands).toEqual(['start', 'stop', 'discard']);
  });

  it('coupe un enregistrement en cours si le match recommence', () => {
    const { commands } = run([obs('reveal', 2, 10, won(2)), obs('intro', 1, 0, null)]);
    expect(commands).toEqual(['start', 'cancel', 'discard']);
  });

  it('refilme la manche 1 d un nouveau match, meme si son numero a deja servi', () => {
    const { commands } = run([
      obs('reveal', 1, 10, won(1)),
      obs('reveal', 1, CLIP_STOP_AT_MS, won(1)),
      obs('ended', 2, 0, won(2)),
      obs('intro', 1, 0, null),
      obs('reveal', 1, 10, won(1)),
    ]);
    expect(commands).toEqual(['start', 'stop', 'discard', 'start']);
  });

  it('ne jette rien a la premiere observation', () => {
    expect(run([obs('intro', 1, 0)]).commands).toEqual([]);
  });
});
