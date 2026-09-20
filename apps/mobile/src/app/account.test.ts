import { describe, expect, it } from 'vitest';
import { accountNotice, groupsOf } from './account.js';

describe('groupsOf', () => {
  /*
    Un code se recopie a la main, souvent depuis un ecran vers un autre
    appareil. Les groupes ne sont pas une coquetterie : c est ce qui permet de
    tenir sa place dans la lecture et de recommencer un groupe plutot que tout
    le code.
  */
  it('decoupe le code en morceaux lisibles', () => {
    expect(groupsOf('AURA-7K2M-94PX-QTJD-3HVN')).toEqual(['AURA', '7K2M', '94PX', 'QTJD', '3HVN']);
  });

  it('supporte un code sans tirets', () => {
    expect(groupsOf('AURA7K2M')).toEqual(['AURA7K2M']);
  });
});

describe('accountNotice', () => {
  /*
    L avertissement le plus important de l ecran, et il doit etre lu AVANT le
    geste, pas apres : presenter un code abandonne la progression de ce
    navigateur-ci. Quelqu un qui a joue trente minutes en invite et qui colle
    le code de son telephone doit savoir que ces trente minutes partent.
  */
  it('previent que presenter un code abandonne la progression locale', () => {
    expect(accountNotice('claim')).toMatch(/abandonn|remplac|perd/i);
  });

  it('dit que le code ne sera plus reaffiche', () => {
    expect(accountNotice('issued')).toMatch(/note|garde|réaffich|revoir/i);
  });

  it('dit qu un nouveau code annule l ancien', () => {
    expect(accountNotice('issued')).toMatch(/ancien|annul|remplac/i);
  });
});
