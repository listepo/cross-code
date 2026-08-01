#!/usr/bin/env node
// code-review-graph: incremental update after write/replace (Gemini CLI hook)
// Must output ONLY JSON on stdout. Low-noise: no systemMessage.
const REPO = '/Users/listepo/GitHub/cross-code';

try {
  // Imported lazily so a missing node_modules still yields valid JSON.
  const { $, stdin } = await import('zx');
  await stdin(); // drain the hook payload
  await $({ quiet: true, nothrow: true })`code-review-graph update --skip-flows --repo ${REPO}`;
} catch {
  // the update is best effort — never fail the tool call
}

process.stdout.write(`${JSON.stringify({ suppressOutput: true })}\n`);
