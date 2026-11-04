// Claude Code PostToolUse hook (.claude/settings.json): formats the file an
// Edit or Write just touched, so agent edits match `pnpm format` without
// waiting for the pre-commit hook. Reads the hook payload as JSON on stdin.
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

// The same files `pnpm format` and lint-staged format.
const extensions = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.mdx']);
const root = realpathSync(path.resolve(import.meta.dirname, '..'));

const { tool_input: toolInput } = JSON.parse(readFileSync(0, 'utf8'));
const file = toolInput?.file_path;

// Skip other file types, and files outside the repo (including `.local`, a
// symlink to a store elsewhere on some machines).
const isInRepo = (target) =>
  !path.relative(root, realpathSync(target)).startsWith('..');

if (file && extensions.has(path.extname(file)) && isInRepo(file)) {
  const { status, stderr } = spawnSync(
    'pnpm',
    ['exec', 'prettier', '--write', '--log-level=warn', file],
    { cwd: root, encoding: 'utf8' }
  );
  if (status !== 0) {
    process.stderr.write(stderr);
    process.exit(1);
  }
}
