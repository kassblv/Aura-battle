// Formate automatiquement le fichier modifié par Claude Code avec Prettier.
// Ne bloque jamais : si Prettier n'est pas encore installé (avant M0), le hook ne fait rien.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join } from 'node:path';

const FORMATTABLE = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.css', '.html', '.yml', '.yaml']);

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const file = input?.tool_input?.file_path;
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const prettier = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'prettier.cmd' : 'prettier');

  if (file && existsSync(file) && FORMATTABLE.has(extname(file)) && !file.includes('/prototype/') && existsSync(prettier)) {
    spawnSync(prettier, ['--write', '--log-level', 'warn', file], { cwd: root, stdio: 'ignore' });
  }
} catch {
  // Silence volontaire : le formatage ne doit jamais interrompre Claude Code.
}
process.exit(0);
