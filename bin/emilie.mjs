#!/usr/bin/env node
/** Émilie : banc d'essai pour vos consignes d'agent de code. */
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fourchetteCo2, fourchetteEnergie, equivalents } from '@carolinedanslesnuages/val/src/rapport.mjs';
import { chargerCas } from '../src/cas.mjs';
import { preparerEspace, empreinteFichiers, fichiersChanges, nettoyerEspace } from '../src/espace.mjs';
import { argumentsAgent, lireFlux, lancerAgent } from '../src/agent.mjs';
import { verifier } from '../src/verifications.mjs';
import { estimer, lireMesures, enregistrerMesure, empreinteMesuree, TOKENS_PAR_DEFAUT } from '../src/estimation.mjs';

const AIDE = `Émilie · banc d'essai pour vos consignes d'agent de code

Usage : emilie [options]

  --cas <dossier>    dossier des cas, un .json par cas (défaut : ./emilie)
  --filtre <texte>   seulement les cas dont le nom contient ce texte
  --fois <n>         rejouer chaque cas n fois (défaut : 1) ; un agent ne répond pas toujours pareil
  --modele <nom>     modèle de l'agent (ex. haiku, sonnet, opus) ; défaut : celui de l'agent
  --agent <commande> commande de l'agent (défaut : claude)
  --a-blanc          affiche le plan et l'estimation, sans rien lancer ni dépenser
  --oui              lance sans demander confirmation
  --garder           garde les dossiers d'essai pour les inspecter
  --delai <s>        durée maximum d'un essai, en secondes (défaut : 600)
  --aide             cette aide

Avant chaque passage, Émilie affiche l'empreinte carbone estimée (méthode de Val) et le coût
connu, puis demande confirmation.`;

function options(args) {
  const o = { cas: 'emilie', fois: 1, agent: 'claude', delai: 600 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const v = () => {
      if (args[i + 1] === undefined) throw new Error(`L'option ${a} attend une valeur.`);
      return args[++i];
    };
    if (a === '--aide' || a === '-h' || a === '--help') o.aide = true;
    else if (a === '--a-blanc') o.aBlanc = true;
    else if (a === '--oui') o.oui = true;
    else if (a === '--garder') o.garder = true;
    else if (a === '--cas') o.cas = v();
    else if (a === '--filtre') o.filtre = v();
    else if (a === '--fois') o.fois = Number(v());
    else if (a === '--modele') o.modele = v();
    else if (a === '--agent') o.agent = v();
    else if (a === '--delai') o.delai = Number(v());
    else throw new Error(`Option inconnue : ${a}. Tapez « emilie --aide ».`);
  }
  if (!Number.isInteger(o.fois) || o.fois < 1) throw new Error('--fois attend un nombre entier positif.');
  return o;
}

const fr = (n) => n.toLocaleString('fr-FR');
// Moins d'un centime : trois décimales, pour ne pas afficher « 0,00 $ ».
const dollars = (usd) => { const d = usd > 0 && usd < 0.01 ? 3 : 2; return `${usd.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} $`; };

function afficherEstimation(cas, o, est) {
  console.log(`Émilie · ${cas.length} cas × ${o.fois} passage${o.fois > 1 ? 's' : ''} = ${cas.length * o.fois} essai${cas.length * o.fois > 1 ? 's' : ''} · agent : ${o.agent}${o.modele ? ` (${o.modele})` : ''}`);
  console.log('');
  for (const l of est.lignes) {
    const c = cas.find((x) => x.nom === l.nom);
    console.log(`  [${c.type.padEnd(6)}] ${l.nom.padEnd(40)} ~${fr(l.tokensSortie)} tokens ${l.mesure ? '(mesuré)' : '(hypothèse)'}`);
  }
  console.log('');
  console.log('Estimation avant de lancer :');
  console.log(`  Empreinte : ${fourchetteCo2(est.total.co2g)} CO2e (${fourchetteEnergie(est.total.energieWh)})`);
  const eq = equivalents(est.total.co2g);
  if (eq.length) console.log(`  Soit environ : ${eq.join(' · ')}`);
  console.log(`  Coût : ${est.total.coutConnu ? `environ ${dollars(est.total.cout)}` : est.total.cout > 0 ? `au moins ${dollars(est.total.cout)} (certains cas jamais mesurés)` : 'inconnu avant un premier passage'}`);
  if (est.lignes.some((l) => !l.mesure)) console.log(`  Les cas jamais lancés comptent ${fr(TOKENS_PAR_DEFAUT)} tokens produits (hypothèse) ; les suivants utiliseront la mesure réelle.`);
  console.log(`  Modèle supposé pour l'empreinte : ${o.modele || 'opus (le plus prudent)'}.`);
}

async function confirmer(o) {
  if (o.oui) return true;
  if (!process.stdin.isTTY) throw new Error('Pas de terminal pour confirmer : ajoutez --oui pour lancer, ou --a-blanc pour seulement estimer.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const reponse = (await rl.question('\nLancer ? (o/N) ')).trim().toLowerCase();
  rl.close();
  return reponse === 'o' || reponse === 'oui';
}

async function essayer(c, o, n) {
  const dossier = await preparerEspace(c);
  try {
    const avant = await empreinteFichiers(dossier);
    const execution = await lancerAgent(o.agent, argumentsAgent(c, { modele: o.modele }), dossier, o.delai);
    const flux = lireFlux(execution.sortie);
    const fichiers = fichiersChanges(avant, await empreinteFichiers(dossier));
    const resultats = verifier(c.attendu, { ...flux, fichiers }, dossier);
    if (!flux.termine && execution.erreurs.trim()) resultats.push({ ok: false, message: `erreur de l'agent : ${execution.erreurs.trim().split('\n')[0].slice(0, 160)}` });
    const ok = resultats.every((r) => r.ok);
    console.log(`${ok ? '✅' : '❌'} ${c.nom}${o.fois > 1 ? ` (${n}/${o.fois})` : ''} · ${resultats.filter((r) => r.ok).length}/${resultats.length} vérifications${flux.cout !== null ? ` · ${dollars(flux.cout)}` : ''}`);
    for (const r of resultats.filter((x) => !x.ok)) console.log(`     ✗ ${r.message}`);
    if (o.garder) console.log(`     dossier gardé : ${dossier}`);
    return { ok, flux };
  } finally {
    if (!o.garder) await nettoyerEspace(dossier);
  }
}

async function principal() {
  const o = options(process.argv.slice(2));
  if (o.aide) return console.log(AIDE);
  const cas = await chargerCas(o.cas, o.filtre);
  if (!cas.length) throw new Error(`Aucun cas ne correspond au filtre « ${o.filtre} ».`);
  const fichierMesures = join(resolve(o.cas), '.emilie-mesures.json');
  const mesures = await lireMesures(fichierMesures);
  afficherEstimation(cas, o, estimer(cas, o.fois, mesures, o.modele || 'opus'));

  if (o.aBlanc) {
    console.log(`\nÀ blanc : rien n'est lancé. Commande pour le premier cas :\n  ${o.agent} ${argumentsAgent(cas[0], { modele: o.modele }).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    return;
  }
  if (!(await confirmer(o))) return console.log('Annulé : rien n\'a été lancé.');
  console.log('');

  const bilan = new Map(cas.map((c) => [c.nom, 0]));
  const usages = [];
  let cout = 0;
  for (const c of cas) {
    for (let n = 1; n <= o.fois; n++) {
      const { ok, flux } = await essayer(c, o, n);
      if (ok) bilan.set(c.nom, bilan.get(c.nom) + 1);
      usages.push(...flux.usages);
      cout += flux.cout || 0;
      const tokens = flux.usages.reduce((s, u) => s + u.tokensSortie, 0);
      if (tokens) await enregistrerMesure(fichierMesures, mesures, c.nom, { tokensSortie: tokens, cout: flux.cout, modele: flux.usages[0] && flux.usages[0].modele });
    }
  }

  const reel = empreinteMesuree(usages);
  console.log('\nBilan :');
  for (const [nom, reussis] of bilan) console.log(`  ${reussis === o.fois ? '✅' : reussis ? '🟠' : '❌'} ${nom} : ${reussis}/${o.fois}`);
  console.log(`\nEmpreinte mesurée : ${fourchetteCo2(reel.co2g)} CO2e pour ${fr(reel.tokensSortie)} tokens produits · coût : ${dollars(cout)}`);
  if ([...bilan.values()].some((r) => r < o.fois)) process.exitCode = 1;
}

principal().catch((e) => {
  console.error(`emilie : ${e.message}`);
  process.exit(1);
});
