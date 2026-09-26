import { useEffect, useState } from 'react';
import type { WeekEvent } from '@aura/protocol';
import { readWeekEvent } from '../net/weekEvent.js';
import { currentPageLocation, resolveServerUrl } from '../net/serverUrl.js';

/** Relecture : une semaine forcee depuis le panneau se voit dans les dix minutes. */
const REFRESH_MS = 10 * 60_000;

/**
 * La semaine servie par le serveur, ou `null` tant qu'il n'a pas repondu.
 *
 * Silencieux : un echec laisse l'accueil sur la rotation locale
 * (`announcedWeekEvent`), qui dit la meme chose sauf semaine forcee.
 */
export function useWeekEvent(accessToken: string | null): WeekEvent | null {
  const [served, setServed] = useState<WeekEvent | null>(null);

  useEffect(() => {
    if (accessToken === null) return;
    let cancelled = false;
    const url = resolveServerUrl(
      import.meta.env.VITE_SERVER_URL,
      window.location.hostname,
      currentPageLocation(),
    );
    const read = (): void => {
      readWeekEvent(url, accessToken).then(
        (week) => {
          if (!cancelled) setServed(week);
        },
        () => undefined,
      );
    };
    read();
    const timer = window.setInterval(read, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accessToken]);

  return served;
}
