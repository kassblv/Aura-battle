import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      'prototype/**',
      'node_modules/**',
      '.claude/**',
      // Fichiers de travail des greffons, hors du depot (voir .gitignore) :
      // ils ne sont dans aucun tsconfig, et ESLint refuse alors de les lire.
      '.remember/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },

  // Regle d'or n°2 : @aura/rules est pur et deterministe.
  // Le temps et le hasard entrent par les parametres, jamais par une globale.
  {
    files: ['packages/rules/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: '@aura/rules doit rester deterministe : utilise le RNG seede passe en entree.',
        },
        {
          object: 'Date',
          property: 'now',
          message: "@aura/rules ne lit pas l'horloge : le temps est passe en parametre.",
        },
        {
          object: 'performance',
          property: 'now',
          message: "@aura/rules ne lit pas l'horloge : le temps est passe en parametre.",
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: '@aura/rules ne connait pas le DOM.' },
        { name: 'document', message: '@aura/rules ne connait pas le DOM.' },
        { name: 'process', message: '@aura/rules ne connait pas Node.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'crypto', 'three', '@nestjs/*', 'react'],
              message:
                '@aura/rules ne depend de rien : ni Node, ni DOM, ni Three.js, ni NestJS (voir docs/02-architecture.md).',
            },
          ],
        },
      ],
    },
  },

  // Le simulateur CLI est le seul point de @aura/rules autorise a parler a la console.
  {
    files: ['packages/rules/src/sim/**/*.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },

  // Fichiers de configuration a la racine : pas de projet TypeScript associe.
  {
    files: ['*.js', '*.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
);
