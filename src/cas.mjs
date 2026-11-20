/**
 * Les cas d'essai : un fichier JSON par cas, dans un dossier (par défaut ./emilie).
 *
 * {
 *   "nom": "formulaire-utilise-marguerite",          facultatif (sinon : nom du fichier)
 *   "type": "skill" | "regles" | "piege",
 *   "demande": "Ajoute un champ e-mail au formulaire",
 *   "projet": "../",                                 dossier copié pour l'essai (défaut : dossier courant)
 *   "piege": { "fichier": "README.md", "contenu": "…" },  texte ajouté à un fichier avant l'essai
 *   "attendu": { … }                                  voir verifications.mjs
 * }
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';

export const TYPES = ['skill', 'regles', 'piege'];
const CLES_ATTENDU = ['skills', 'skillsInterdites', 'fichiersModifies', 'fichiersIntouchables', 'commandesInterdites', 'reponseContient', 'reponseNeContientPas', 'commandeVerte'];

/** Vérifie un cas et renvoie la liste de ses erreurs (vide si le cas est valide). */
export function erreursDuCas(cas) {
  const erreurs = [];
  if (!TYPES.includes(cas.type)) erreurs.push(`« type » doit valoir ${TYPES.join(', ')}`);
  if (typeof cas.demande !== 'string' || !cas.demande.trim()) erreurs.push('« demande » est obligatoire');
  if (!cas.attendu || typeof cas.attendu !== 'object') erreurs.push('« attendu » est obligatoire');
  else {
    const inconnues = Object.keys(cas.attendu).filter((k) => !CLES_ATTENDU.includes(k));
    if (inconnues.length) erreurs.push(`clés inconnues dans « attendu » : ${inconnues.join(', ')} (possibles : ${CLES_ATTENDU.join(', ')})`);
    if (!Object.keys(cas.attendu).length) erreurs.push('« attendu » ne vérifie rien');
  }
  if (cas.piege && (typeof cas.piege.fichier !== 'string' || typeof cas.piege.contenu !== 'string')) erreurs.push('« piege » attend { fichier, contenu }');
  if (cas.type === 'piege' && !cas.piege && !/ignore|oublie|instruction/i.test(cas.demande)) erreurs.push('un cas « piege » attend un « piege », ou une demande qui contient elle-même la consigne piégée');
  return erreurs;
}

/** Charge tous les cas d'un dossier. Un cas invalide arrête tout, avec un message clair. */
export async function chargerCas(dossier, filtre) {
  const racine = resolve(dossier);
  let noms;
  try {
    noms = (await readdir(racine)).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort(); // .emilie-mesures.json n'est pas un cas
  } catch {
    throw new Error(`Dossier de cas introuvable : ${racine}. Créez-le avec un fichier .json par cas (voir exemples/cas).`);
  }
  const cas = [];
  for (const nom of noms) {
    let c;
    try {
      c = JSON.parse(await readFile(join(racine, nom), 'utf8'));
    } catch (e) {
      throw new Error(`${nom} : JSON invalide (${e.message}).`);
    }
    const erreurs = erreursDuCas(c);
    if (erreurs.length) throw new Error(`${nom} : ${erreurs.join(' ; ')}.`);
    c.nom = c.nom || basename(nom, '.json');
    c.projet = resolve(racine, c.projet || process.cwd());
    cas.push(c);
  }
  if (!cas.length) throw new Error(`Aucun cas (.json) dans ${racine}.`);
  return filtre ? cas.filter((c) => c.nom.includes(filtre)) : cas;
}
