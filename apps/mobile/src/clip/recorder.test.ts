import { describe, expect, it } from 'vitest';
import {
  CLIP_BITRATE,
  CLIP_FPS,
  containerOf,
  createClipRecorder,
  pickMimeType,
  type MediaRecorderClass,
  type MediaRecorderLike,
  clipFrameDue,
} from './recorder.js';

interface Track {
  stopped: boolean;
  stop(): void;
}

function fakeStream(): { stream: MediaStream; tracks: Track[] } {
  const tracks: Track[] = [
    {
      stopped: false,
      stop() {
        this.stopped = true;
      },
    },
  ];
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks };
}

/** Un faux `MediaRecorder` : il livre les morceaux qu on lui donne a l arret. */
function fakeRecorder(supported: readonly string[], chunks: readonly string[] = ['abc', 'def']) {
  const made: { options: unknown; instance: MediaRecorderLike }[] = [];
  class Fake implements MediaRecorderLike {
    state = 'inactive';
    ondataavailable: ((event: { readonly data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_stream: MediaStream, options: unknown) {
      made.push({ options, instance: this });
    }
    static isTypeSupported(type: string): boolean {
      return supported.includes(type);
    }
    start(): void {
      this.state = 'recording';
    }
    stop(): void {
      this.state = 'inactive';
      for (const chunk of chunks) this.ondataavailable?.({ data: new Blob([chunk]) });
      queueMicrotask(() => this.onstop?.());
    }
  }
  return { Recorder: Fake as MediaRecorderClass, made };
}

describe('pickMimeType', () => {
  it('prefere le MP4 H.264, le plus partageable', () => {
    const { Recorder } = fakeRecorder(['video/webm', 'video/mp4;codecs=avc1', 'video/mp4']);
    expect(pickMimeType(Recorder)).toBe('video/mp4;codecs=avc1');
  });

  it('se rabat sur le WebM quand le MP4 ne s encode pas', () => {
    const { Recorder } = fakeRecorder(['video/webm']);
    expect(pickMimeType(Recorder)).toBe('video/webm');
  });

  it('ne rend rien sans MediaRecorder ni format connu', () => {
    expect(pickMimeType(undefined)).toBeNull();
    expect(pickMimeType(fakeRecorder([]).Recorder)).toBeNull();
  });

  it('retire les parametres du type de fichier', () => {
    expect(containerOf('video/mp4;codecs=avc1')).toBe('video/mp4');
    expect(containerOf('video/webm')).toBe('video/webm');
  });
});

describe('createClipRecorder', () => {
  it('filme le canvas a 30 i/s et ≈ 4 Mb/s, et rend une video du bon type', async () => {
    const { stream, tracks } = fakeStream();
    const fps: number[] = [];
    const { Recorder, made } = fakeRecorder(['video/mp4;codecs=avc1']);
    const recorder = createClipRecorder(
      {
        captureStream: (rate) => {
          fps.push(rate);
          return stream;
        },
      },
      Recorder,
    );

    expect(recorder.start()).toBe(true);
    expect(fps).toEqual([CLIP_FPS]);
    expect(made[0]?.options).toEqual({
      mimeType: 'video/mp4;codecs=avc1',
      videoBitsPerSecond: CLIP_BITRATE,
    });

    const blob = await recorder.stop();
    expect(blob?.type).toBe('video/mp4');
    expect(await blob?.text()).toBe('abcdef');
    // Les pistes sont liberees : le canvas n est plus capture.
    expect(tracks[0]?.stopped).toBe(true);
  });

  it('ne demarre pas deux fois', () => {
    const { Recorder } = fakeRecorder(['video/webm']);
    const recorder = createClipRecorder({ captureStream: () => fakeStream().stream }, Recorder);
    expect(recorder.start()).toBe(true);
    expect(recorder.start()).toBe(false);
  });

  it('rend null sans MediaRecorder', async () => {
    const recorder = createClipRecorder({ captureStream: () => fakeStream().stream }, undefined);
    expect(recorder.mimeType).toBeNull();
    expect(recorder.start()).toBe(false);
    expect(await recorder.stop()).toBeNull();
  });

  it('rend null sans captureStream', async () => {
    const { Recorder } = fakeRecorder(['video/webm']);
    const recorder = createClipRecorder({}, Recorder);
    expect(recorder.start()).toBe(false);
    expect(await recorder.stop()).toBeNull();
  });

  it('rend null quand rien n a ete enregistre', async () => {
    const { Recorder } = fakeRecorder(['video/webm'], []);
    const recorder = createClipRecorder({ captureStream: () => fakeStream().stream }, Recorder);
    recorder.start();
    expect(await recorder.stop()).toBeNull();
  });

  it('jette un enregistrement annule et peut en recommencer un', async () => {
    const { stream, tracks } = fakeStream();
    const { Recorder } = fakeRecorder(['video/webm']);
    const recorder = createClipRecorder({ captureStream: () => stream }, Recorder);
    recorder.start();
    recorder.cancel();
    expect(tracks[0]?.stopped).toBe(true);
    expect(await recorder.stop()).toBeNull();
    expect(recorder.start()).toBe(true);
  });

  it('survit a un MediaRecorder qui refuse de demarrer', () => {
    class Broken {
      static isTypeSupported(): boolean {
        return true;
      }
      constructor() {
        throw new Error('NotSupportedError');
      }
    }
    const { stream, tracks } = fakeStream();
    const recorder = createClipRecorder(
      { captureStream: () => stream },
      Broken as unknown as MediaRecorderClass,
    );
    expect(recorder.start()).toBe(false);
    expect(tracks[0]?.stopped).toBe(true);
  });
});

/*
  Une erreur du navigateur en pleine revelation (application mise en arriere-
  plan sur iOS, encodeur perdu) : il emet « error » puis « stop » AUSSITOT,
  et un `stop()` ulterieur sur un enregistreur inactif ne fait plus rien.
  Sans ecoute des la mise en route, la promesse d'arret ne se resolvait
  jamais — et le bouton restait sur « Preparation… » jusqu'au match suivant.
*/
describe('createClipRecorder — erreur en cours d enregistrement', () => {
  it('rend null a l arret, sans attendre un evenement qui ne viendra plus', async () => {
    const { Recorder, made } = fakeRecorder(['video/mp4']);
    const { stream } = fakeStream();
    const recorder = createClipRecorder({ captureStream: () => stream }, Recorder);
    expect(recorder.start()).toBe(true);

    const instance = made[0]!.instance as MediaRecorderLike & { state: string; stop: () => void };
    instance.state = 'inactive';
    instance.stop = () => undefined;
    instance.onerror?.();
    instance.onstop?.();

    const result = await Promise.race([
      recorder.stop(),
      new Promise<'pendu'>((resolve) => setTimeout(() => resolve('pendu'), 200)),
    ]);
    expect(result).toBeNull();
  });
});

/*
  L'arene tourne a 60 ou 120 Hz ; la video n'echantillonne que 30 images par
  seconde. Composer chaque image de l'arene gaspillait le travail pendant le
  choc — le moment le plus lourd, et celui qu'on filme.
*/
describe('clipFrameDue', () => {
  it('compose au plus trente images par seconde', () => {
    expect(clipFrameDue(null, 0)).toBe(true);
    expect(clipFrameDue(0, 8)).toBe(false);
    expect(clipFrameDue(0, 16)).toBe(false);
    expect(clipFrameDue(0, 33)).toBe(true);
  });

  // Une marge : une image de 60 Hz arrivee a 32,9 ms ne doit pas faire sauter une image.
  it('tolere le battement d une horloge a 60 Hz', () => {
    expect(clipFrameDue(0, 31.5)).toBe(true);
  });
});
