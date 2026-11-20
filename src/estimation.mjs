/**
 * Estimation AVANT de lancer : tokens produits, empreinte carbone (méthode de Val) et coût.
 *
 * Au premier passage, Émilie ne sait pas combien un cas consomme : elle part d'une hypothèse
 * (TOKENS_PAR_DEFAUT) et le dit. Après chaque vrai passage, elle mémorise la mesure réelle de
 * chaque cas (fichier .emilie-mesures.json) : les estimations suivantes reposent sur ces mesures.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { empreinte, famille } from '@carolinedanslesnuages/val/src/methode.mjs';

/** Hypothèse pour un cas jamais mesuré : une petite tâche d'agent (lecture, une modification). */
export const TOKENS_PAR_DEFAUT = 3000;

export async function lireMesures(fichier) {
  try {
    return JSON.parse(await readFile(fichier, 'utf8'));
  } catch {
    return {};
  }
}

/** Ajoute une mesure (moyenne glissante sur les 5 dernières) et enregistre. */
export async function enregistrerMesure(fichier, mesures, nom, { tokensSortie, cout, modele }) {
  const m = mesures[nom] || { passages: [] };
  m.passages = [...m.passages, { tokensSortie, cout, modele }].slice(-5);
  mesures[nom] = m;
  await writeFile(fichier, JSON.stringify(mesures, null, 2) + '\n');
}

const moyenne = (liste) => (liste.length ? liste.reduce((a, b) => a + b, 0) / liste.length : null);

/**
 * @returns {{ lignes: {nom, tokensSortie, mesure: boolean, cout: number|null}[], total: { tokensSortie, co2g, energieWh, cout, coutConnu } }}
 */
export function estimer(cas, fois, mesures, modele = 'opus') {
  const lignes = cas.map((c) => {
    const passages = (mesures[c.nom] && mesures[c.nom].passages) || [];
    const tokens = moyenne(passages.map((p) => p.tokensSortie)) ?? TOKENS_PAR_DEFAUT;
    const couts = passages.map((p) => p.cout).filter((x) => Number.isFinite(x));
    return { nom: c.nom, tokensSortie: Math.round(tokens * fois), mesure: passages.length > 0, cout: couts.length ? moyenne(couts) * fois : null };
  });
  const e = empreinte(lignes.map((l) => ({ modele: famille(modele), tokensEntree: 0, tokensSortie: l.tokensSortie })));
  return {
    lignes,
    total: {
      tokensSortie: e.tokensSortie,
      co2g: e.co2g,
      energieWh: e.energieWh,
      cout: lignes.reduce((s, l) => s + (l.cout || 0), 0),
      coutConnu: lignes.every((l) => l.cout !== null),
    },
  };
}

/** Empreinte réelle d'un passage, à partir des tokens rapportés par l'agent. */
export const empreinteMesuree = (usages) => empreinte(usages);
