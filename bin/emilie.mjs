#!/usr/bin/env node
/** Émilie: a test bench for your coding agent guidelines. */
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { co2Range, energyRange, equivalents } from '@carolinedanslesnuages/val/src/report.mjs';
import { loadCases } from '../src/cases.mjs';
import { prepareWorkspace, fileFingerprints, changedFiles, cleanWorkspace } from '../src/workspace.mjs';
import { agentArguments, readStream, runAgent } from '../src/agent.mjs';
import { runChecks } from '../src/checks.mjs';
import { estimate, readMeasurements, saveMeasurement, measuredFootprint, DEFAULT_OUTPUT_TOKENS } from '../src/estimate.mjs';

const HELP = `Émilie · banc d'essai pour vos consignes d'agent de code

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

function parseOptions(args) {
  const options = { casesFolder: 'emilie', repetitions: 1, agent: 'claude', timeoutSeconds: 600 };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const nextValue = () => {
      if (args[index + 1] === undefined) throw new Error(`L'option ${argument} attend une valeur.`);
      return args[++index];
    };
    if (argument === '--aide' || argument === '-h' || argument === '--help') options.help = true;
    else if (argument === '--a-blanc') options.dryRun = true;
    else if (argument === '--oui') options.yes = true;
    else if (argument === '--garder') options.keep = true;
    else if (argument === '--cas') options.casesFolder = nextValue();
    else if (argument === '--filtre') options.nameFilter = nextValue();
    else if (argument === '--fois') options.repetitions = Number(nextValue());
    else if (argument === '--modele') options.model = nextValue();
    else if (argument === '--agent') options.agent = nextValue();
    else if (argument === '--delai') options.timeoutSeconds = Number(nextValue());
    else throw new Error(`Option inconnue : ${argument}. Tapez « emilie --aide ».`);
  }
  if (!Number.isInteger(options.repetitions) || options.repetitions < 1) throw new Error('--fois attend un nombre entier positif.');
  return options;
}

const french = (number) => number.toLocaleString('fr-FR');
const plural = (count, word) => `${count} ${word}${count > 1 ? 's' : ''}`;

/** Below one cent: three decimals, so as not to show "0,00 $". */
function dollars(amountUsd) {
  const decimals = amountUsd > 0 && amountUsd < 0.01 ? 3 : 2;
  return `${amountUsd.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} $`;
}

function costText(total) {
  if (total.costKnown) return `environ ${dollars(total.cost)}`;
  if (total.cost > 0) return `au moins ${dollars(total.cost)} (certains cas jamais mesurés)`;
  return 'inconnu avant un premier passage';
}

function printEstimate(cases, options, estimated) {
  const runCount = cases.length * options.repetitions;
  const agentLabel = `${options.agent}${options.model ? ` (${options.model})` : ''}`;
  console.log(`Émilie · ${cases.length} cas × ${plural(options.repetitions, 'passage')} = ${plural(runCount, 'essai')} · agent : ${agentLabel}`);
  console.log('');
  for (const estimateRow of estimated.rows) {
    const testCase = cases.find((candidate) => candidate.nom === estimateRow.name);
    console.log(`  [${testCase.type.padEnd(6)}] ${estimateRow.name.padEnd(40)} ~${french(estimateRow.outputTokens)} tokens ${estimateRow.measured ? '(mesuré)' : '(hypothèse)'}`);
  }
  console.log('');
  console.log('Estimation avant de lancer :');
  console.log(`  Empreinte : ${co2Range(estimated.total.co2Grams)} CO2e (${energyRange(estimated.total.energyWh)})`);
  const comparisons = equivalents(estimated.total.co2Grams);
  if (comparisons.length) console.log(`  Soit environ : ${comparisons.join(' · ')}`);
  console.log(`  Coût : ${costText(estimated.total)}`);
  if (estimated.rows.some((estimateRow) => !estimateRow.measured)) {
    console.log(`  Les cas jamais lancés comptent ${french(DEFAULT_OUTPUT_TOKENS)} tokens produits (hypothèse) ; les suivants utiliseront la mesure réelle.`);
  }
  console.log(`  Modèle supposé pour l'empreinte : ${options.model || 'opus (le plus prudent)'}.`);
}

async function confirm(options) {
  if (options.yes) return true;
  if (!process.stdin.isTTY) throw new Error('Pas de terminal pour confirmer : ajoutez --oui pour lancer, ou --a-blanc pour seulement estimer.');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const reply = (await prompt.question('\nLancer ? (o/N) ')).trim().toLowerCase();
  prompt.close();
  return reply === 'o' || reply === 'oui';
}

async function runCase(testCase, options, runNumber) {
  const folder = await prepareWorkspace(testCase);
  try {
    const before = await fileFingerprints(folder);
    const execution = await runAgent(options.agent, agentArguments(testCase, { model: options.model }), folder, options.timeoutSeconds);
    const stream = readStream(execution.output);
    const files = changedFiles(before, await fileFingerprints(folder));
    const results = runChecks(testCase.attendu, { ...stream, files }, folder);
    if (!stream.finished && execution.errors.trim()) {
      results.push({ passed: false, message: `erreur de l'agent : ${execution.errors.trim().split('\n')[0].slice(0, 160)}` });
    }
    const passed = results.every((result) => result.passed);
    const runLabel = options.repetitions > 1 ? ` (${runNumber}/${options.repetitions})` : '';
    const costLabel = stream.cost !== null ? ` · ${dollars(stream.cost)}` : '';
    console.log(`${passed ? '✅' : '❌'} ${testCase.nom}${runLabel} · ${results.filter((result) => result.passed).length}/${results.length} vérifications${costLabel}`);
    for (const result of results.filter((candidate) => !candidate.passed)) console.log(`     ✗ ${result.message}`);
    if (options.keep) console.log(`     dossier gardé : ${folder}`);
    return { passed, stream };
  } finally {
    if (!options.keep) await cleanWorkspace(folder);
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) return console.log(HELP);
  const cases = await loadCases(options.casesFolder, options.nameFilter);
  if (!cases.length) throw new Error(`Aucun cas ne correspond au filtre « ${options.nameFilter} ».`);
  const measurementsPath = join(resolve(options.casesFolder), '.emilie-mesures.json');
  const measurements = await readMeasurements(measurementsPath);
  printEstimate(cases, options, estimate(cases, options.repetitions, measurements, options.model || 'opus'));

  if (options.dryRun) {
    const commandLine = agentArguments(cases[0], { model: options.model }).map((argument) => (/\s/.test(argument) ? JSON.stringify(argument) : argument)).join(' ');
    console.log(`\nÀ blanc : rien n'est lancé. Commande pour le premier cas :\n  ${options.agent} ${commandLine}`);
    return;
  }
  if (!(await confirm(options))) return console.log('Annulé : rien n\'a été lancé.');
  console.log('');

  const successes = new Map(cases.map((testCase) => [testCase.nom, 0]));
  const usages = [];
  let totalCost = 0;
  for (const testCase of cases) {
    for (let runNumber = 1; runNumber <= options.repetitions; runNumber++) {
      const { passed, stream } = await runCase(testCase, options, runNumber);
      if (passed) successes.set(testCase.nom, successes.get(testCase.nom) + 1);
      usages.push(...stream.usages);
      totalCost += stream.cost || 0;
      const outputTokens = stream.usages.reduce((total, usage) => total + usage.outputTokens, 0);
      if (outputTokens) {
        await saveMeasurement(measurementsPath, measurements, testCase.nom, { outputTokens, cost: stream.cost, model: stream.usages[0] && stream.usages[0].model });
      }
    }
  }

  const actual = measuredFootprint(usages);
  console.log('\nBilan :');
  for (const [caseName, passedRuns] of successes) {
    const symbol = passedRuns === options.repetitions ? '✅' : passedRuns ? '🟠' : '❌';
    console.log(`  ${symbol} ${caseName} : ${passedRuns}/${options.repetitions}`);
  }
  console.log(`\nEmpreinte mesurée : ${co2Range(actual.co2Grams)} CO2e pour ${french(actual.outputTokens)} tokens produits · coût : ${dollars(totalCost)}`);
  if ([...successes.values()].some((passedRuns) => passedRuns < options.repetitions)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`emilie : ${error.message}`);
  process.exit(1);
});
