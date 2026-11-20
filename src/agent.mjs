/**
 * Lance l'agent sur un cas et lit son flux d'événements (format stream-json de Claude Code).
 * L'agent est une commande : « claude » par défaut, ou toute commande qui produit ce flux.
 */
import { spawn } from 'node:child_process';

/** Arguments donnés à Claude Code : projet isolé de vos réglages personnels, modifications permises. */
export function argumentsAgent(cas, { modele } = {}) {
  const args = ['-p', cas.demande, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--setting-sources', 'project,local', '--strict-mcp-config'];
  if (modele) args.push('--model', modele);
  return args;
}

/** Lit le flux : outils appelés, réponse finale, tokens par modèle, coût. */
export function lireFlux(texte) {
  const outils = [];
  let fin = null;
  for (const ligne of texte.split('\n')) {
    if (!ligne.trim()) continue;
    let d;
    try {
      d = JSON.parse(ligne);
    } catch {
      continue;
    }
    if (d.type === 'assistant' && d.message && Array.isArray(d.message.content)) {
      for (const c of d.message.content) if (c.type === 'tool_use') outils.push({ nom: c.name, entree: c.input || {} });
    } else if (d.type === 'result') fin = d;
  }
  const usages = Object.entries((fin && fin.modelUsage) || {}).map(([modele, u]) => ({
    modele,
    tokensEntree: (u.inputTokens || 0) + (u.cacheReadInputTokens || 0) + (u.cacheCreationInputTokens || 0),
    tokensSortie: u.outputTokens || 0,
  }));
  return {
    outils,
    skills: outils.filter((o) => o.nom === 'Skill').map((o) => o.entree.skill || o.entree.name).filter(Boolean),
    commandes: outils.filter((o) => o.nom === 'Bash').map((o) => String(o.entree.command || '')),
    reponse: fin ? String(fin.result || '') : '',
    termine: !!fin && !fin.is_error,
    cout: fin && Number.isFinite(fin.total_cost_usd) ? fin.total_cost_usd : null,
    usages,
  };
}

/** Exécute la commande de l'agent dans le dossier d'essai, avec un délai maximum. */
export function lancerAgent(commande, args, dossier, delaiSecondes = 600) {
  return new Promise((resoudre) => {
    const [exe, ...prefixe] = commande.split(' ').filter(Boolean);
    const p = spawn(exe, [...prefixe, ...args], { cwd: dossier, stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    let erreurs = '';
    p.stdout.on('data', (d) => (sortie += d));
    p.stderr.on('data', (d) => (erreurs += d));
    const minuteur = setTimeout(() => p.kill('SIGTERM'), delaiSecondes * 1000);
    p.on('error', (e) => {
      clearTimeout(minuteur);
      resoudre({ code: -1, sortie, erreurs: `${erreurs}${e.message}` });
    });
    p.on('close', (code) => {
      clearTimeout(minuteur);
      resoudre({ code, sortie, erreurs });
    });
  });
}
