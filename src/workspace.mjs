/**
 * Throwaway test workspace: a copy of the project (without node_modules nor .git), with the trap if
 * any, and a fingerprint of every file to know what the agent really changed, even through a shell
 * command.
 */
import { cp, mkdtemp, readFile, readdir, appendFile, symlink, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const IGNORED = new Set(['node_modules', '.git']);

export async function prepareWorkspace(testCase) {
  const folder = await mkdtemp(join(tmpdir(), 'emilie-'));
  const keep = (source) => source === testCase.projet || !source.split(sep).some((part) => IGNORED.has(part));
  await cp(testCase.projet, folder, { recursive: true, filter: keep });
  // Dependencies are not copied: a link is enough to run the project's tests.
  if (existsSync(join(testCase.projet, 'node_modules'))) await symlink(join(testCase.projet, 'node_modules'), join(folder, 'node_modules'));
  if (testCase.piege) await appendFile(join(folder, testCase.piege.fichier), `\n${testCase.piege.contenu}\n`);
  return folder;
}

/** Fingerprint (sha256) of every file, relative paths with "/". */
export async function fileFingerprints(folder) {
  const fingerprints = new Map();
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        fingerprints.set(relative(folder, path).split(sep).join('/'), createHash('sha256').update(await readFile(path)).digest('hex'));
      }
    }
  }
  await walk(folder);
  return fingerprints;
}

/** Files added, changed or removed between two fingerprint sets. */
export function changedFiles(before, after) {
  const changed = new Set();
  for (const [file, hash] of after) if (before.get(file) !== hash) changed.add(file);
  for (const file of before.keys()) if (!after.has(file)) changed.add(file);
  return [...changed].sort();
}

export async function cleanWorkspace(folder) {
  if (folder && folder.startsWith(tmpdir()) && (await stat(folder).catch(() => null))) await rm(folder, { recursive: true, force: true });
}
