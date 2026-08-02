# DeepSeek CR — AI code review

Code review powered by [DeepSeek CR](https://github.com/marketplace/actions/deepseek-cr)
(`hustcer/deepseek-review`) on GitHub Actions, and by this repo's own
google/zx-based CLI (`tools/deepseek-cr.mjs`) locally.

## GitHub Action

`.github/workflows/code-review.yml` reviews every pull request automatically:

- **Trigger:** PR opened / reopened / synchronized (`pull_request_target`), so
  the action runs with write access to post the review even from forks.
- **Permission:** `pull-requests: write` (nothing else).
- **Skip:** add `skip cr` / `skip review` to the PR title or body, or lock the
  PR conversation.
- **Trigger on mention (optional):** uncomment `watch-mention` in the workflow;
  a PR comment containing `@github-actions` (by OWNER/MEMBER/COLLABORATOR)
  triggers a review.

### Setup

1. Get a DeepSeek API key from <https://platform.deepseek.com>.
2. Add it as a repository secret:
   **Settings → Secrets and variables → Actions → New repository secret**,
   name `CHAT_TOKEN`.
3. Done — the workflow posts reviews on PRs. Adjust the `sys-prompt`, `model`
   or `base-url` inputs in the workflow to switch providers (e.g. SiliconFlow,
   GitHub Models).

## Local code review (google/zx)

`tools/deepseek-cr.mjs` is a drop-in reimplementation of the `cr` CLI from
`hustcer/deepseek-review`, rewritten on [google/zx](https://github.com/google/zx)
(Node-based). No nushell, no awk — just Node 20+ and `zx`, which is already a
workspace devDependency.

### Setup

```bash
# token: env var or config
export CHAT_TOKEN=sk-...            # DeepSeek API key
export GITHUB_TOKEN=ghp_...         # only needed for remote PR review

# optional config (all fields optional; CLI flags take precedence)
cp tools/deepseek-cr.config.example.json .deepseek-cr.config.json
# edit .deepseek-cr.config.json — it is gitignored (contains your token)
```

### Usage

```bash
# review the current uncommitted diff
tools/deepseek-cr

# review a commit range
tools/deepseek-cr --diff-from HEAD~2 --diff-to HEAD

# review changes produced by a git command
tools/deepseek-cr --patch-cmd 'git show HEAD~1'
tools/deepseek-cr -c 'git diff 2393375 71f5a31'

# review a remote PR (uses GITHUB_TOKEN)
tools/deepseek-cr --pr-number 42 --repo listepo/cross-code

# write the report to a file (markdown, streaming disabled)
tools/deepseek-cr --diff-from HEAD~1 --output review.md

# filter files, pick a model
tools/deepseek-cr --include '**/*.ts' --exclude 'package-lock.json'
tools/deepseek-cr --model deepseek-reasoner   # R1

tools/deepseek-cr --help                       # all flags
```

Security note: `--patch-cmd` accepts only `git show` / `git diff` commands;
anything else is rejected.

Config file resolution: `--config <file>` → `DEEPSEEK_CR_CONFIG` →
`./.deepseek-cr.config.json` (gitignored). A template lives at
`tools/deepseek-cr.config.example.json`.
