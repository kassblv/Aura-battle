import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NameEditor } from './NameEditor.js';

const render = (): string =>
  renderToStaticMarkup(
    createElement(NameEditor, {
      name: 'Invite 4417',
      busy: false,
      error: null,
      onRename: () => Promise.resolve(true),
    }),
  );

describe('NameEditor', () => {
  it('offre de changer de nom depuis le profil, avec une vraie cible tactile', () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*class="name-editor__open"[^>]*>/);
    expect(html).toContain('Changer de nom');
  });

  it('ne montre pas le champ tant qu on ne l a pas demande', () => {
    expect(render()).not.toContain('<input');
  });
});
