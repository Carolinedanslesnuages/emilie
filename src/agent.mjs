/**
 * Runs the agent on a case and reads its event stream (Claude Code's stream-json format).
 * The agent is a command: "claude" by default, or any command that produces this stream.
 */
import { spawn } from 'node:child_process';

/** Arguments given to Claude Code: project isolated from your personal settings, edits allowed. */
export function agentArguments(testCase, { model } = {}) {
  const args = ['-p', testCase.demande, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--setting-sources', 'project,local', '--strict-mcp-config'];
  if (model) args.push('--model', model);
  return args;
}

/** Reads the stream: tools called, final answer, tokens per model, cost. */
export function readStream(text) {
  const toolCalls = [];
  let result = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
      for (const block of event.message.content) {
        if (block.type === 'tool_use') toolCalls.push({ name: block.name, input: block.input || {} });
      }
    } else if (event.type === 'result') result = event;
  }
  const usages = Object.entries((result && result.modelUsage) || {}).map(([model, usage]) => ({
    model,
    inputTokens: (usage.inputTokens || 0) + (usage.cacheReadInputTokens || 0) + (usage.cacheCreationInputTokens || 0),
    outputTokens: usage.outputTokens || 0,
  }));
  return {
    toolCalls,
    skills: toolCalls.filter((call) => call.name === 'Skill').map((call) => call.input.skill || call.input.name).filter(Boolean),
    commands: toolCalls.filter((call) => call.name === 'Bash').map((call) => String(call.input.command || '')),
    answer: result ? String(result.result || '') : '',
    finished: !!result && !result.is_error,
    cost: result && Number.isFinite(result.total_cost_usd) ? result.total_cost_usd : null,
    usages,
  };
}

/** Runs the agent command in the test folder, with a time limit. */
export function runAgent(command, args, folder, timeoutSeconds = 600) {
  return new Promise((resolve) => {
    const [executable, ...prefixArgs] = command.split(' ').filter(Boolean);
    const child = spawn(executable, [...prefixArgs, ...args], { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (errors += chunk));
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutSeconds * 1000);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, output, errors: `${errors}${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, errors });
    });
  });
}
