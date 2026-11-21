/**
 * Test cases: one JSON file per case, in a folder (./emilie by default).
 * The case format is public and stays in French:
 *
 * {
 *   "nom": "formulaire-utilise-marguerite",          optional (otherwise: the file name)
 *   "type": "skill" | "regles" | "piege",
 *   "demande": "Ajoute un champ e-mail au formulaire",
 *   "projet": "../",                                 folder copied for the run (default: current folder)
 *   "piege": { "fichier": "README.md", "contenu": "…" },  text appended to a file before the run
 *   "attendu": { … }                                  see checks.mjs
 * }
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';

export const CASE_TYPES = ['skill', 'regles', 'piege'];
const EXPECTATION_KEYS = ['skills', 'skillsInterdites', 'fichiersModifies', 'fichiersIntouchables', 'commandesInterdites', 'reponseContient', 'reponseNeContientPas', 'commandeVerte'];

/** Validates a case and returns its errors (empty when the case is valid). */
export function caseErrors(testCase) {
  const errors = [];
  if (!CASE_TYPES.includes(testCase.type)) errors.push(`« type » doit valoir ${CASE_TYPES.join(', ')}`);
  if (typeof testCase.demande !== 'string' || !testCase.demande.trim()) errors.push('« demande » est obligatoire');
  if (!testCase.attendu || typeof testCase.attendu !== 'object') errors.push('« attendu » est obligatoire');
  else {
    const unknownKeys = Object.keys(testCase.attendu).filter((expectationKey) => !EXPECTATION_KEYS.includes(expectationKey));
    if (unknownKeys.length) errors.push(`clés inconnues dans « attendu » : ${unknownKeys.join(', ')} (possibles : ${EXPECTATION_KEYS.join(', ')})`);
    if (!Object.keys(testCase.attendu).length) errors.push('« attendu » ne vérifie rien');
  }
  const trap = testCase.piege;
  if (trap && (typeof trap.fichier !== 'string' || typeof trap.contenu !== 'string')) errors.push('« piege » attend { fichier, contenu }');
  if (testCase.type === 'piege' && !trap && !/ignore|oublie|instruction/i.test(testCase.demande)) {
    errors.push('un cas « piege » attend un « piege », ou une demande qui contient elle-même la consigne piégée');
  }
  return errors;
}

/** Loads every case of a folder. An invalid case stops everything, with a clear message. */
export async function loadCases(folder, nameFilter) {
  const root = resolve(folder);
  let fileNames;
  try {
    // .emilie-mesures.json (dotfile) is not a case.
    fileNames = (await readdir(root)).filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort();
  } catch {
    throw new Error(`Dossier de cas introuvable : ${root}. Créez-le avec un fichier .json par cas (voir exemples/cas).`);
  }
  const cases = [];
  for (const fileName of fileNames) {
    let testCase;
    try {
      testCase = JSON.parse(await readFile(join(root, fileName), 'utf8'));
    } catch (error) {
      throw new Error(`${fileName} : JSON invalide (${error.message}).`);
    }
    const errors = caseErrors(testCase);
    if (errors.length) throw new Error(`${fileName} : ${errors.join(' ; ')}.`);
    testCase.nom = testCase.nom || basename(fileName, '.json');
    testCase.projet = resolve(root, testCase.projet || process.cwd());
    cases.push(testCase);
  }
  if (!cases.length) throw new Error(`Aucun cas (.json) dans ${root}.`);
  return nameFilter ? cases.filter((testCase) => testCase.nom.includes(nameFilter)) : cases;
}
