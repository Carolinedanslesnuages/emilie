/**
 * Estimate BEFORE running: produced tokens, carbon footprint (Val's method) and cost.
 *
 * On the first run, Émilie does not know how much a case uses: she starts from an assumption
 * (DEFAULT_OUTPUT_TOKENS) and says so. After each real run, she stores the actual measurement of
 * each case (.emilie-mesures.json, French keys kept for existing files): later estimates rely on it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { footprint, modelFamily } from '@carolinedanslesnuages/val/src/method.mjs';

/** Assumption for a case never measured: a small agent task (some reading, one edit). */
export const DEFAULT_OUTPUT_TOKENS = 3000;

export async function readMeasurements(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
}

/** Adds a measurement (rolling average over the last 5) and saves. */
export async function saveMeasurement(path, measurements, caseName, { outputTokens, cost, model }) {
  const entry = measurements[caseName] || { passages: [] };
  entry.passages = [...entry.passages, { tokensSortie: outputTokens, cout: cost, modele: model }].slice(-5);
  measurements[caseName] = entry;
  await writeFile(path, JSON.stringify(measurements, null, 2) + '\n');
}

const average = (values) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : null);

/**
 * @returns {{ rows: {name, outputTokens, measured: boolean, cost: number|null}[], total: { outputTokens, co2Grams, energyWh, cost, costKnown } }}
 */
export function estimate(cases, repetitions, measurements, model = 'opus') {
  const rows = cases.map((testCase) => {
    const runs = (measurements[testCase.nom] && measurements[testCase.nom].passages) || [];
    const tokens = average(runs.map((measuredRun) => measuredRun.tokensSortie)) ?? DEFAULT_OUTPUT_TOKENS;
    const costs = runs.map((measuredRun) => measuredRun.cout).filter((cost) => Number.isFinite(cost));
    return { name: testCase.nom, outputTokens: Math.round(tokens * repetitions), measured: runs.length > 0, cost: costs.length ? average(costs) * repetitions : null };
  });
  const estimated = footprint(rows.map((estimateRow) => ({ model: modelFamily(model), inputTokens: 0, outputTokens: estimateRow.outputTokens })));
  return {
    rows,
    total: {
      outputTokens: estimated.outputTokens,
      co2Grams: estimated.co2Grams,
      energyWh: estimated.energyWh,
      cost: rows.reduce((total, estimateRow) => total + (estimateRow.cost || 0), 0),
      costKnown: rows.every((estimateRow) => estimateRow.cost !== null),
    },
  };
}

/** Actual footprint of a run, from the tokens reported by the agent. */
export const measuredFootprint = (usages) => footprint(usages);
