/**
 * L enregistreur du clip : un canvas en entree, une video en sortie.
 *
 * `captureStream(30)` + `MediaRecorder`, mesures dans l essai de l ADR 0017 :
 * le MP4 H.264 est pris en charge par Chrome et par Safari (iOS 14.3+), le
 * WebM partout ailleurs. On prend le premier format que le navigateur sait
 * ENCODER — un format qu il sait seulement lire ne sert a rien ici.
 *
 * Sans `MediaRecorder` ou sans `captureStream`, rien ne casse : `start` rend
 * `false` et `stop` rend `null`. Le bouton de partage n apparait simplement
 * pas.
 */

/** Du plus partageable au plus repandu : iOS refuse souvent un WebM. */
export const CLIP_MIME_TYPES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
] as const;

/** ≈ 4 Mb/s : 5 s tiennent en 2,5 Mo, net sur un telephone. */
export const CLIP_BITRATE = 4_000_000;
export const CLIP_FPS = 30;

/** Le strict necessaire de `MediaRecorder`, pour pouvoir le simuler. */
export interface MediaRecorderLike {
  readonly state: string;
  ondataavailable: ((event: { readonly data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

export interface MediaRecorderClass {
  new (
    stream: MediaStream,
    options: { mimeType: string; videoBitsPerSecond: number },
  ): MediaRecorderLike;
  isTypeSupported(type: string): boolean;
}

export interface CapturableCanvas {
  captureStream?: (fps: number) => MediaStream;
}

export interface ClipRecorder {
  /** Le format retenu, ou `null` si le navigateur ne sait rien encoder. */
  readonly mimeType: string | null;
  /** Commence a filmer. Rend `false` si c est impossible. */
  start(): boolean;
  /** Arrete et rend la video, ou `null` s il n y a rien de lisible. */
  stop(): Promise<Blob | null>;
  /** Arrete et jette. */
  cancel(): void;
}

/** Le premier format que ce navigateur sait encoder. */
export function pickMimeType(recorder: MediaRecorderClass | undefined): string | null {
  if (recorder === undefined) return null;
  for (const type of CLIP_MIME_TYPES) {
    try {
      if (recorder.isTypeSupported(type)) return type;
    } catch {
      // Une implementation partielle qui leve : on essaie le suivant.
    }
  }
  return null;
}

/** Le type d un fichier, sans ses parametres : `video/mp4;codecs=avc1` -> `video/mp4`. */
export function containerOf(mimeType: string): string {
  return mimeType.split(';')[0]?.trim() ?? mimeType;
}

export function createClipRecorder(
  canvas: CapturableCanvas,
  Recorder: MediaRecorderClass | undefined = (globalThis as { MediaRecorder?: MediaRecorderClass })
    .MediaRecorder,
): ClipRecorder {
  const mimeType = typeof canvas.captureStream === 'function' ? pickMimeType(Recorder) : null;

  let recorder: MediaRecorderLike | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];

  const release = (): void => {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    recorder = null;
  };

  return {
    mimeType,

    start(): boolean {
      if (mimeType === null || Recorder === undefined || recorder !== null) return false;
      try {
        stream = canvas.captureStream?.(CLIP_FPS) ?? null;
        if (stream === null) return false;
        const next = new Recorder(stream, { mimeType, videoBitsPerSecond: CLIP_BITRATE });
        chunks = [];
        next.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        next.start();
        recorder = next;
        return true;
      } catch {
        release();
        return false;
      }
    },

    stop(): Promise<Blob | null> {
      const current = recorder;
      if (current === null || mimeType === null) return Promise.resolve(null);
      return new Promise((resolve) => {
        const finish = (): void => {
          const parts = chunks;
          chunks = [];
          release();
          resolve(parts.length === 0 ? null : new Blob(parts, { type: containerOf(mimeType) }));
        };
        current.onstop = finish;
        current.onerror = () => {
          chunks = [];
          finish();
        };
        try {
          current.stop();
        } catch {
          chunks = [];
          finish();
        }
      });
    },

    cancel(): void {
      const current = recorder;
      if (current === null) return;
      current.ondataavailable = null;
      current.onstop = null;
      chunks = [];
      try {
        if (current.state !== 'inactive') current.stop();
      } catch {
        // Deja arrete : rien a jeter de plus.
      }
      release();
    },
  };
}
