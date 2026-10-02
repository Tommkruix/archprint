# Getting started

Archprint mines the architecture rules your repo already follows, gates them on evidence, and emits them into
the tools you already use.

**Find the rules your code already follows:**

![archprint scan listing the rules a Next.js API already follows, with the evidence for each](/demo/scan.gif)

**See the evidence behind one:**

![archprint explain showing the confidence gate behind AP-001](/demo/explain.gif)

**Enforce them in ESLint, watch a break get caught, and remove it all again:**

![archprint init and wire adding the rules to ESLint, lint catching a route that imports the database, and eject restoring the config exactly](/demo/enforce.gif)

**Or just ask your agent.** Claude Code calls archprint over MCP on its own:

![Claude Code answering "What architecture rules does this repo already follow?" by calling archprint](/demo/claude-code.gif)

**Measured, with and without archprint.** The same question in Claude Code (Opus 5.5) on the demo app (70
files), five runs each, median [range]:

|                   | Without archprint         | With archprint            |
| ----------------- | ------------------------- | ------------------------- |
| Tokens read       | 81k [58k to 96k]          | 52k [52k to 52k]          |
| Tokens written    | 1.1k [1.1k to 1.4k]       | 0.6k [0.6k to 0.6k]       |
| Cost per question | $0.083 [$0.078 to $0.153] | $0.037 [$0.032 to $0.076] |
| Time              | 17 s [15 to 19]           | 10 s [9 to 31]            |
| Tool calls        | 5 [4 to 10]               | 2 [2 to 2]                |

Both found the main rule (routes reach the database only through `lib/services/`). With archprint, every run gave
the evidence for each rule and named the one file that breaks one (`lib/db.ts` reads `process.env` outside the
config layer); no run without it noticed that. Without archprint, Claude also described naming conventions
archprint does not check. About 50k of the tokens read in both columns are Claude Code's own system prompt. This
is one small repo; larger ones are not measured yet.
[Method, harness and every answer](https://github.com/Tommkruix/archprint-demo/tree/main/bench).

## Try it in your browser

[Open the demo in StackBlitz](https://stackblitz.com/github/Tommkruix/archprint-demo), nothing to install. It is a
small Next.js API whose routes reach the database only through a service layer. The scan runs as soon as it opens,
and the [demo's README](https://github.com/Tommkruix/archprint-demo#try-it) walks through enforcing a rule in
ESLint, breaking it, and asking for the rules over MCP.

## Install

```bash
npm install --save-dev archprint
```

Or run it without installing with `npx archprint scan .`, or build from source:

```bash
git clone https://github.com/Tommkruix/archprint
cd archprint
npm ci
npm run build
node dist/cli.js scan <path-to-your-app>
```

Requires Node >= 20. Point Archprint at a directory that has a `tsconfig.json` (for a monorepo, a package such
as `apps/web`; a monorepo root works too, Archprint discovers the app directories and skips whatever git ignores,
including nested `.gitignore` files and `.git/info/exclude`).

## The 60-second path

```bash
# One command: detect the stack, enforce the rules your code already follows,
# and record what to adopt next in .archprint/config.json
archprint init apps/web
```

`init` scans the repo, writes the auto-trusted (mechanical) rules into `.archprint/` (only for the linters
your repo uses, it detects ESLint and dependency-cruiser), adds a managed section to your `README.md`
explaining what it did, and prints three tiers: what is enforced now, what to review before
enforcing, and what comparable repos commonly adopt that you do not yet. Then reference the generated rules from
your linter:

```bash
archprint wire      # inserts a managed, reversible reference into your eslint / dependency-cruiser config
```

Run your linter (eslint, dependency-cruiser) as usual and the archprint rules are in effect. To undo everything:

```bash
archprint eject     # removes the generated files and every wired reference, restoring your configs exactly
```

## The deliberate path

If you would rather inspect before you enforce:

```bash
# See the rules your repo already follows, with the evidence
archprint scan apps/web

# Drill into one rule: gate breakdown, offending lines, how to fix, when not to use it
archprint explain AP-002 apps/web

# Write the auto-trusted mechanical rules (structural ones are held for review)
archprint generate apps/web

# Check the generated rules pass on your repo before you wire them
archprint generate apps/web --check

# Emit one specific rule after reviewing it (including a SUGGEST rule)
archprint generate apps/web --rule AP-001

# Narrow the output, or force a format regardless of detected tooling
archprint generate apps/web --only console
archprint generate apps/web --emit all

# Also emit the structural-inference families (review these first)
archprint generate apps/web --include-structural

# Also write the granular per-family files, rule cards, fixtures, and graph
archprint generate apps/web --expand
```

`generate` re-cleans its own previous output each run, so the generated rules never drift from the current code.
The default output is one self-contained `.archprint/eslint.mjs` (adopt it in one line with
`import archprint from './.archprint/eslint.mjs'`) and, when dependency-cruiser is present, one
`.archprint/dependency-cruiser.json`; `--expand` adds the per-family configs, per-rule cards and fixtures, and
`ts-arch` tests for the first-party boundaries (`architecture.archprint.ts`, opt-in: import it from a test, or
point your test glob at it, so it is not collected until you choose).

Upgrading an existing project from an older `archprint-rules/` layout? Run `archprint migrate` once (after
updating the package); it moves everything to `.archprint/` and rewires your linter config in place.

## For a fresh or thin repo

```bash
archprint recommend apps/web
```

`recommend` works even with little code to learn from: it sorts every rule family into enforce-now / review /
adopt-from-day-one, names the installed tool that will enforce each rule (or what to install), and the adopt
tier is backed by a census of tens of thousands of public TypeScript repos (stack-aware), not hand-picked
defaults.

## CI

`scan --json` and `recommend --json` emit stable, version-keyed JSON for scripting. Exit codes are the
contract: `0` on success, `1` on error.

## Use with AI agents (MCP)

`archprint mcp` runs archprint as an MCP server over stdio so Claude, Cursor, and other agents can inspect the
rules your repo already follows before they write code. It exposes read-only `archprint_scan`,
`archprint_recommend`, and `archprint_explain` tools. Each rule comes back stated in plain words, with its
evidence and the files that break it, and `archprint_explain` takes any rule label from the scan (for example
`AP-002` or `env-access`). Point any MCP client at it:

```json
{
  "mcpServers": {
    "archprint": { "command": "npx", "args": ["-y", "archprint", "mcp"] }
  }
}
```

That is a local stdio server over the repo you point the client at, and it is the one to use for private code:
your source never leaves your machine, whichever git host you use.

To scan a public repository by URL instead, run a remote server over HTTP with `archprint mcp --http`: it clones
the repo shallow to a temp dir (public `github.com`, `gitlab.com`, or `bitbucket.org` only), runs the same
read-only analysis, returns the result, and deletes the clone. The tools then take a `repo` URL and an optional
`ref`. It binds `0.0.0.0:8848/mcp` by default; pass `--host 127.0.0.1` to keep it on your own machine, or `--port`
(or `$PORT`) to change the port. Health checks answer at `/health` (use this one on Cloud Run, which reserves
`/healthz`) and `/healthz`. Every request clones and scans, so keep a hosted instance behind authentication, such
as Cloud Run's IAM, unless you accept paying for anyone's scans.

## Next

- [Concepts](./concepts.md) — the confidence gate, mechanical vs. structural, fast vs. deep, the lifecycle.
- [Rules](./rules.md) — every rule family: what it detects, its evidence, and when not to use it.
