#!/usr/bin/env zx
/**
 * DeepSeek CR — local AI code review CLI, rewritten on google/zx.
 *
 * Drop-in replacement for the nushell-based `cr` from hustcer/deepseek-review,
 * with the same flags. Requires only Node 20+ and zx (already a workspace
 * devDependency) — no nushell, no awk.
 *
 * Usage:
 *   zx tools/deepseek-cr.mjs                 review the current `git diff`
 *   zx tools/deepseek-cr.mjs --diff-from HEAD~1 --diff-to HEAD
 *   zx tools/deepseek-cr.mjs -c 'git show HEAD~1'
 *   zx tools/deepseek-cr.mjs --pr-number 42 --repo listepo/cross-code
 *   zx tools/deepseek-cr.mjs -o review.md
 *
 * Token: first positional arg, or CHAT_TOKEN env var, or config `token`.
 * Config: --config <file> | DEEPSEEK_CR_CONFIG | ./.deepseek-cr.config.json
 */
import { argv, chalk, fs, path } from 'zx'

const HELP = `
Use DeepSeek AI to review code changes locally

Usage:
  > zx tools/deepseek-cr.mjs {flags} (token)

Flags:
  -h, --help            Display this help
  -d, --debug           Debug mode
  -r, --repo <string>   GitHub repo name, e.g. listepo/cross-code (for --pr-number)
  -n, --pr-number <string>  GitHub PR number to review (remote)
  -k, --gh-token <string>   GitHub token, fallback to GITHUB_TOKEN env var
  -f, --diff-from <string>  Git diff starting commit SHA
  -t, --diff-to <string>    Git diff ending commit SHA
  -c, --patch-cmd <string>  A \`git show\` / \`git diff\` command to produce the diff
  -l, --max-length <int>    Max content length to review, 0 = no limit
  -m, --model <string>      Model name (env CHAT_MODEL), default deepseek-v4-flash
  -b, --base-url <string>   API base URL (env BASE_URL), default https://api.deepseek.com
  -U, --chat-url <string>   Full chat API URL, e.g. http://localhost:11535/api/chat
  -s, --sys-prompt <string> System prompt
  -u, --user-prompt <string> User prompt
  -i, --include <string>    Comma-separated file patterns to include
  -x, --exclude <string>    Comma-separated file patterns to exclude
  -T, --temperature <float> Model temperature 0-2, default 0.3
  -C, --config <string>     Config file path (JSON), default ./.deepseek-cr.config.json
  -o, --output <string>     Output file path (markdown)

Parameters:
  token <string>  Your DeepSeek API token, fallback to CHAT_TOKEN env var
`

const DEFAULT_SYS_PROMPT =
  'You are a professional code review assistant responsible for analyzing code changes in GitHub Pull Requests. Identify potential issues such as code style violations, logical errors, security vulnerabilities, and provide improvement suggestions. Clearly list the problems and recommendations in a concise manner.'
const DEFAULT_USER_PROMPT = 'Please review the following code changes'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getArg(...names) {
  for (const n of names) {
    if (argv[n] !== undefined) return argv[n]
  }
  return undefined
}

/** Unicode width approximation (code points), matches the original's intent. */
function width(s) {
  return [...s].length
}

/** Glob (with * and ?) to RegExp, `*` may span directories like the original. */
function globToRegex(glob) {
  const escaped = glob
    .split('*')
    .join('__STAR__')
    .split('?')
    .join('__QMARK__')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .split('__STAR__')
    .join('.*')
    .split('__QMARK__')
    .join('.')
  return new RegExp(`^${escaped}$`)
}

/** Keep only hunks whose file matches include/exclude patterns. */
function filterDiff(diff, include, exclude) {
  const includes = (include || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const excludes = (exclude || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (includes.length === 0 && excludes.length === 0) return diff
  const includeRe = includes.map(globToRegex)
  const excludeRe = excludes.map(globToRegex)

  return diff
    .split(/(?=^diff --git )/m)
    .map((hunk) => {
      const m = hunk.match(/^diff --git a\/(?:.*?) b\/(\S+)/m)
      if (!m) return hunk // headers (index, ---, etc.) pass through
      const file = m[1]
      if (excludeRe.some((re) => re.test(file))) return ''
      if (includeRe.length > 0 && !includeRe.some((re) => re.test(file))) return ''
      return hunk
    })
    .join('')
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

async function loadConfig() {
  const configPath =
    getArg('config', 'C') ||
    process.env.DEEPSEEK_CR_CONFIG ||
    path.join(process.cwd(), '.deepseek-cr.config.json')
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    return { path: configPath, data: JSON.parse(raw) }
  } catch {
    return { path: configPath, data: {} }
  }
}

// ---------------------------------------------------------------------------
// Diff acquisition
// ---------------------------------------------------------------------------

async function getLocalDiff(from, to) {
  const parts = ['diff']
  if (from && to) parts.push(from, to)
  else if (from) parts.push(from)
  const { stdout } = await $`git ${parts}`.quiet()
  return stdout
}

async function getPrDiff(repo, prNumber, ghToken) {
  const headers = {
    'User-Agent': 'deepseek-cr',
    Accept: 'application/vnd.github.diff',
  }
  if (ghToken) headers.Authorization = `Bearer ${ghToken}`
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
    headers,
  })
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`)
  }
  return res.text()
}

// ---------------------------------------------------------------------------
// DeepSeek API
// ---------------------------------------------------------------------------

async function review({ token, model, baseUrl, chatUrl, temperature, maxLength, sysPrompt, userPrompt, diff, output, debug }) {
  const url = chatUrl || `${baseUrl}/chat/completions`
  const stream = !output // stream to console, plain response to file
  const payload = {
    model,
    stream,
    temperature,
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: `${userPrompt}:\n${diff}` },
    ],
  }

  if (debug) console.log(chalk.gray(`POST ${url} model=${model} bytes=${Buffer.byteLength(diff)}`))

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300)
    throw new Error(`DeepSeek API ${res.status} ${res.statusText}: ${body}`)
  }

  if (!stream) {
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content ?? ''
    await fs.writeFile(output, content)
    console.log(chalk.green(`\nReview written to ${output}`))
    return
  }

  // SSE streaming
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const chunk = JSON.parse(data)
        const piece = chunk.choices?.[0]?.delta?.content ?? ''
        if (piece) process.stdout.write(piece)
      } catch {
        /* keep-alive or partial JSON — ignore */
      }
    }
  }
  process.stdout.write('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (getArg('h', 'help')) {
  console.log(HELP)
  process.exit(0)
}

const debug = !!getArg('d', 'debug')
const config = await loadConfig()
const c = config.data

const positionalToken = (argv._ ?? [])[0]
const token = positionalToken || process.env.CHAT_TOKEN || c.token || c['chat-token']
if (!token) {
  console.error(chalk.red('No DeepSeek API token. Pass it as an argument or set CHAT_TOKEN (or config `token`).'))
  process.exit(1)
}

const diffFrom = getArg('diff-from', 'f')
const diffTo = getArg('diff-to', 't')
const patchCmd = getArg('patch-cmd', 'c')
const prNumber = getArg('pr-number', 'n')
const repo = getArg('repo', 'r') || c['default-github-repo'] || ''
const ghToken = getArg('gh-token', 'k') || process.env.GITHUB_TOKEN || c['github-token'] || ''
const model = getArg('model', 'm') || process.env.CHAT_MODEL || c.model || 'deepseek-v4-flash'
const baseUrl = getArg('base-url', 'b') || process.env.BASE_URL || c['base-url'] || 'https://api.deepseek.com'
const chatUrl = getArg('chat-url', 'U') || process.env.CHAT_URL || c['chat-url'] || ''
const temperature = Number(getArg('temperature', 'T') ?? c.temperature ?? 0.3)
const maxLength = Number(getArg('max-length', 'l') ?? c['max-length'] ?? 0)
const sysPrompt = getArg('sys-prompt', 's') || c['sys-prompt'] || DEFAULT_SYS_PROMPT
const userPrompt = getArg('user-prompt', 'u') || c['user-prompt'] || DEFAULT_USER_PROMPT
const include = getArg('include', 'i') ?? c['include-patterns'] ?? ''
const exclude = getArg('exclude', 'x') ?? c['exclude-patterns'] ?? 'pnpm-lock.yaml,package-lock.json,*.lock'
const output = getArg('output', 'o')

console.log(chalk.cyan('\n🚀 Initiate the code review by DeepSeek AI for local changes ...\n'))
console.log(
  chalk.green('------------------------------------------------------------------------------------------'),
)
console.log(` model       | ${model}`)
console.log(` chat_url    | ${chatUrl || `${baseUrl}/chat/completions`}`)
console.log(` exclude     | ${exclude}`)
if (prNumber) console.log(` pr_number   | ${prNumber} (${repo})`)
if (diffFrom) console.log(` diff_from   | ${diffFrom}`)
if (diffTo) console.log(` diff_to     | ${diffTo}`)
console.log(` max_length  | ${maxLength}`)
console.log(` local_repo  | ${process.cwd()}`)
console.log(` temperature | ${temperature}`)
console.log(
  chalk.green('------------------------------------------------------------------------------------------\n'),
)

let diff
if (patchCmd) {
  if (!/^git (show|diff)\b/.test(patchCmd.trim())) {
    console.error(chalk.red('--patch-cmd must be a `git show` or `git diff` command.'))
    process.exit(1)
  }
  diff = (await $`sh -c ${patchCmd}`.quiet()).stdout
} else if (prNumber) {
  if (!repo) {
    console.error(chalk.red('--pr-number requires --repo (or config `default-github-repo`).'))
    process.exit(1)
  }
  diff = await getPrDiff(repo, prNumber, ghToken)
} else {
  diff = await getLocalDiff(diffFrom, diffTo)
}

diff = filterDiff(diff, include, exclude).trim()
if (!diff) {
  console.log(chalk.yellow('Nothing to review.'))
  process.exit(0)
}

const length = width(diff)
if (maxLength > 0 && length > maxLength) {
  console.log(chalk.yellow(`Content length ${length} exceeds max length ${maxLength}, review skipped.`))
  process.exit(0)
}

console.log(chalk.green(`Review content length: ${length}, current max length: ${maxLength}\n`))
console.log(chalk.green(`Waiting for response from ${chatUrl || `${baseUrl}/chat/completions`} ...\n`))

try {
  await review({ token, model, baseUrl, chatUrl, temperature, maxLength, sysPrompt, userPrompt, diff, output, debug })
} catch (error) {
  console.error(chalk.red(`\nError: ${error.message}`))
  process.exit(1)
}
