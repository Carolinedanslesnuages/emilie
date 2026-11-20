/**
 * Espace d'essai jetable : une copie du projet (sans node_modules ni .git), avec le piège éventuel,
 * et une empreinte de chaque fichier pour savoir ce que l'agent a vraiment modifié, même par une
 * commande shell.
 */
import { cp, mkdtemp, readFile, readdir, appendFile, symlink, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const IGNORES = new Set(['node_modules', '.git']);

export async function preparerEspace(cas) {
  const dossier = await mkdtemp(join(tmpdir(), 'emilie-'));
  await cp(cas.projet, dossier, { recursive: true, filter: (src) => !src.split(sep).some((p) => IGNORES.has(p)) || src === cas.projet });
  // Les dépendances ne sont pas copiées : un lien suffit pour lancer les tests du projet.
  if (existsSync(join(cas.projet, 'node_modules'))) await symlink(join(cas.projet, 'node_modules'), join(dossier, 'node_modules'));
  if (cas.piege) await appendFile(join(dossier, cas.piege.fichier), `\n${cas.piege.contenu}\n`);
  return dossier;
}

/** Empreinte (sha256) de chaque fichier, chemins relatifs avec « / ». */
export async function empreinteFichiers(dossier) {
  const resultat = new Map();
  async function parcourir(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (IGNORES.has(e.name)) continue;
      const chemin = join(d, e.name);
      if (e.isDirectory()) await parcourir(chemin);
      else if (e.isFile()) resultat.set(relative(dossier, chemin).split(sep).join('/'), createHash('sha256').update(await readFile(chemin)).digest('hex'));
    }
  }
  await parcourir(dossier);
  return resultat;
}

/** Fichiers ajoutés, modifiés ou supprimés entre deux empreintes. */
export function fichiersChanges(avant, apres) {
  const changes = new Set();
  for (const [f, h] of apres) if (avant.get(f) !== h) changes.add(f);
  for (const f of avant.keys()) if (!apres.has(f)) changes.add(f);
  return [...changes].sort();
}

export async function nettoyerEspace(dossier) {
  if (dossier && dossier.startsWith(tmpdir()) && (await stat(dossier).catch(() => null))) await rm(dossier, { recursive: true, force: true });
}
