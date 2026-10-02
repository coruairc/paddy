# Paddy 🍀

<p align="center">
  <img src="ui/public/paddy-icon.jpg" width="160" height="160" alt="Paddy">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/based%20on-OpenClaw-blue?style=flat-square" alt="Based on OpenClaw">
</p>

Paddy is an Irish-roots fork of [OpenClaw](https://github.com/openclaw/openclaw).
The Gateway, channels, agent runtime, and plugin system are OpenClaw's.
The command you run is `paddy`.

Not affiliated with the OpenClaw Foundation, Nous Research, Guinness, or Paddy Irish Whiskey.

## What is different

|                   |                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Command**       | `paddy` and `openclaw` are the same binary. `openclaw` stays so upstream paths, plugin imports, and existing scripts keep working.                            |
| **Install**       | The installer clones this fork. The default checkout is `~/.paddy/src`.                                                                                       |
| **State**         | Sessions, config, and logs stay in `~/.openclaw`, or `$OPENCLAW_STATE_DIR` when that is set.                                                                  |
| **Hermes import** | `paddy migrate hermes` copies supported Hermes config, memory files, skills, and MCP servers into this install. It does not replace OpenClaw's memory engine. |

## Install

Paddy is distributed as source. The installer clones it, installs workspace dependencies
with pnpm, builds, and puts `paddy` on your PATH. You need git and
**Node 24.16+ or 26.1+**; the installer offers to fetch either if missing.

macOS / Linux / WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/coruairc/paddy/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/coruairc/paddy/main/install.ps1 | iex
```

Skip the first-run wizard:

```bash
curl -fsSL https://raw.githubusercontent.com/coruairc/paddy/main/install.sh | bash -s -- --no-onboard
```

The first build takes a while — this is a large workspace. `--skip-build` clones and
installs dependencies without building. `--git-dir`, `--bin-dir`, `--ref`, and `--repo`
override the defaults; the same values are settable through `PADDY_*` environment variables.

<details>
<summary>Manual install from a checkout</summary>

```bash
git clone https://github.com/coruairc/paddy.git
cd paddy
pnpm install --frozen-lockfile
pnpm build
pnpm ui:build
pnpm paddy onboard --install-daemon
```

</details>

## Quick start

```bash
paddy onboard --install-daemon   # verify model access, create the workspace, configure the Gateway
paddy gateway status
paddy gateway                    # run the Gateway in the foreground
paddy dashboard                  # open the Control UI
```

Send a message in the Control UI to confirm the assistant is working.

## Memory

Memory is plain Markdown in the agent workspace (default `~/.openclaw/workspace`):
`MEMORY.md`, `USER.md`, and daily notes under `memory/`. Recall searches those files.
Nothing is stored in a separate Paddy database.

```bash
paddy memory status
paddy memory search "meeting notes"
paddy memory index --force
paddy memory promote --limit 10          # review short-term candidates
paddy memory promote --apply             # append the top candidates to MEMORY.md
paddy memory forget --session <id> --dry-run
```

To bring an existing Hermes workspace across:

```bash
paddy migrate hermes --dry-run
paddy migrate apply hermes
```

## How it fits together

- The [Gateway](https://docs.openclaw.ai/gateway) is the local control plane for sessions, tools, events, and channel connections.
- The [Control UI](https://docs.openclaw.ai/web/control-ui), CLI, and [TUI](https://docs.openclaw.ai/web/tui) connect to the Gateway.
- [Channels](https://docs.openclaw.ai/channels) bring the assistant to WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, and other messaging services.
- [Companion apps and nodes](https://docs.openclaw.ai/platforms) add voice, Canvas, camera, screen, and device-local actions on supported platforms.

Paddy works with hosted and local [model providers](https://docs.openclaw.ai/concepts/model-providers).
Its [tools](https://docs.openclaw.ai/tools), [skills](https://docs.openclaw.ai/tools/skills), and
[plugins](https://docs.openclaw.ai/plugins) extend what an assistant can do.
Memory behavior is documented in [Memory](https://docs.openclaw.ai/concepts/memory).

## Security

Treat inbound messages as untrusted input. DM-capable channels pair unknown senders by default;
approve a pairing request with `paddy pairing approve <channel> <code>`.

Tools run on the host for the main session unless you configure sandboxing. Read the
[security guide](https://docs.openclaw.ai/gateway/security),
[exposure runbook](https://docs.openclaw.ai/gateway/security/exposure-runbook), and
[sandboxing guide](https://docs.openclaw.ai/gateway/sandboxing) before connecting other users
or exposing the Gateway remotely.

## Documentation

Upstream OpenClaw docs apply to the Gateway, channels, tools, and memory. Use `paddy` wherever those docs say `openclaw`.

| Goal                             | Start here                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Configure models and auth        | [Models](https://docs.openclaw.ai/concepts/models) · [Model providers](https://docs.openclaw.ai/concepts/model-providers)               |
| Connect a messaging service      | [Channels](https://docs.openclaw.ai/channels)                                                                                           |
| Add tools, skills, and plugins   | [Tools](https://docs.openclaw.ai/tools) · [Skills](https://docs.openclaw.ai/tools/skills) · [Plugins](https://docs.openclaw.ai/plugins) |
| Run apps and device nodes        | [Platforms](https://docs.openclaw.ai/platforms) · [Nodes](https://docs.openclaw.ai/nodes)                                               |
| Use the CLI and chat commands    | [CLI reference](https://docs.openclaw.ai/cli) · [Slash commands](https://docs.openclaw.ai/tools/slash-commands)                         |
| Configure or operate the Gateway | [Configuration](https://docs.openclaw.ai/gateway/configuration) · [Architecture](https://docs.openclaw.ai/concepts/architecture)        |

## Development

The repository is a pnpm workspace. Plain `npm install` at the repository root is not supported.

```bash
pnpm install
pnpm build
pnpm check:changed     # smart diff-scoped check gate
pnpm test              # unit suite; `pnpm test <path>` for one file
pnpm ui:build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Paddy tracks
`openclaw/openclaw` as `upstream` and merges (never rebases) to stay current.

## Built on OpenClaw

Paddy is a fork of [OpenClaw](https://github.com/openclaw/openclaw), MIT licensed,
Copyright © 2026 OpenClaw Foundation. OpenClaw is developed in the open by the OpenClaw
Foundation, an independent 501(c)(3); Paddy is not affiliated with or endorsed by it.

The upstream `LICENSE` and `THIRD_PARTY_NOTICES.md` are retained unchanged, as the MIT
license requires. Portions of OpenClaw were adapted from [Pi / pi-mono](https://github.com/earendil-works/pi-mono)
(MIT, © 2025 Mario Zechner); bundled icon work derives from GitHub Octicons (MIT).
The Paddy mark in `ui/public/paddy-icon.jpg` comes from [paddy-gui](https://github.com/coruairc/paddy-gui).

## License

MIT — see [LICENSE](LICENSE).
