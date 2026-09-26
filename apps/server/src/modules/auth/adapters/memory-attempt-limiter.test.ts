import { describeAttemptLimiterContract } from './attempt-limiter.contract.js';
import { MemoryAttemptLimiter } from './memory-attempt-limiter.js';

/** Le double se verifie lui-meme : il sert aux tests du service. */
describeAttemptLimiterContract('memoire', (windowMs) => {
  let now = 0;
  return Promise.resolve({
    limiter: new MemoryAttemptLimiter({ windowMs, now: () => now }),
    elapse: (ms) => {
      now += ms;
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  });
});
