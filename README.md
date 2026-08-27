<h1 align="center">loop</h1>

<p align="center"><a href="README.zh.md">中文</a> | English</p>

<p align="center">Scheduled loop plugin: `/loop` command + `loop` tool (self-adjusting by the model) + active status bar on the chat page, with support for multiple concurrent loops</p>

<p align="center">
  <img src="https://badgen.net/badge/license/MIT/green" alt="license">
  [![dshfind](https://dshfind.com/api/badge/vlln/dsh-loop)](https://dshfind.com/en/plugins/vlln/dsh-loop?ref=badge)
  [![dsh.so security](https://www.dsh.so/badge/dsh-loop.svg)](https://www.dsh.so/artifact/dsh-loop)
</p>

Delivers a prompt to the current agent at a fixed interval — ideal for polling, PR babysitting, and build-fix-test cycles. Aligned with Claude Code's `/loop` semantics, **multiple loops can run concurrently in a single session**. Delivered as an official **bundle plugin** (`dsh.bundle` + dshClient channel), 0 patch.

## Preview

![loop status bar (real run screenshot: multiple loops collapse into a count bar, expanding lists them one by one)](https://cdn.jsdelivr.net/gh/vlln/dsh-loop@main/docs/preview/loop.png?v=2)

## Features

**Tool** (registered via `defineTool`, the model can self-adjust on every turn):

| Tool | Description |
|---|---|
| `loop` | start (start a new loop) / stop (stop a specific one or all) / status / list (list loops in the current session) |

**Commands** (user side):

| Command | Description |
|---|---|
| `/loop [interval] <prompt>` | Start a new loop (interval `5m`/`30s`/`1h`/`2d` or a bare number = minutes; bare `/loop` uses the built-in maintenance prompt) |
| `/loop list` | List all loops in the current session (with ids) |
| `/loop stop <id>` / `/loop stop` | Stop a specific loop / stop all |

**UI** (dock slot above the input box on the chat page):

| Feature | Description |
|---|---|
| Active status bar | Single loop: `● ⟳ looping · <prompt> · 5m · next in 23s`; multiple loops collapse into a count bar "N loops running · expand", click to expand the list |

## Installation

**Recommended: one-line install from a git source** (build artifacts are committed, so a git source does not trigger a build):

```sh
dsh plugin --profile web add "github:vlln/dsh-loop#main"   # one-line git source (build artifacts committed)
# or npm source: dsh plugin --profile web add @vlln/dsh-loop@0.3.0
```

Or from a local directory (when you have the source): `git clone`, then `cd dsh-loop && dsh plugin --profile web add .`.

After installing, **restart web** for it to take effect (bundles are composed at startup); afterwards you can disable/enable it from the "Plugins" panel on the settings page (takes effect at runtime + persisted).

## Usage

```sh
# User side
/loop 5m check PRs on the deploy branch   # delivered every 5 minutes
/loop list                                # loop-1: every 5m — check PRs on the deploy branch
/loop stop loop-1                         # stop a specific one
/loop stop                                # stop all

# Model side (loop tool)
loop action=start prompt="fix flaky test" interval="2m"
loop action=status
loop action=stop loop_id="loop-2"
```

Loops live in the current harness process and disappear when the process exits (not persisted across restarts, consistent with Claude Code `/loop`).

## Development

```sh
pnpm install
pnpm run build      # tsdown: Node half (lib/index.mjs) + client bundle (lib/client.js)
```

- Node half: `src/index.mjs` (commands/tool/loops status route `/plugins/dsh-loop/loops`)
- client: `src/client/index.tsx` (dock slot status bar)

## License

MIT License (example plugin of the DSH ecosystem).
