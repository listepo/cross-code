#!/usr/bin/env node
// code-review-graph: session start status (Gemini CLI hook)
// Must output ONLY JSON on stdout. Logs go to stderr. Never blocks the session.
const REPO = '/Users/listepo/GitHub/cross-code';

let systemMessage = '';
try {
  // Imported lazily so a missing node_modules still yields valid JSON.
  const { $, stdin } = await import('zx');
  await stdin(); // drain the hook payload
  const status = await $({ quiet: true, nothrow: true })`code-review-graph status --repo ${REPO}`;
  [systemMessage = ''] = status.stdall.split('\n');
} catch {
  // status is best effort — fall through with an empty message
}

process.stdout.write(`${JSON.stringify({ systemMessage, suppressOutput: true })}\n`);
