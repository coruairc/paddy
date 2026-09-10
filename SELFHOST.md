# Run Paddy Irishman on your machine

Paddy is a super harness: gateway presence plus a closed learning loop. This kit is the same app you tried in the preview. Hook **your** subscriptions and keys. The hosted demo’s SuperGrok quota is not yours.

Not affiliated with the OpenClaw Foundation, Nous Research, OpenAI, Anthropic, Google, DeepSeek, Poolside, or xAI.

## Install from git (recommended)

Same shape as the usual harness installers. Needs git and Node.js 22+.

```bash
curl -fsSL https://raw.githubusercontent.com/coruairc/paddy/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/coruairc/paddy/main/install.ps1 | iex
```

That clones [coruairc/paddy](https://github.com/coruairc/paddy), runs `npm install`, and puts `paddy` on your PATH. Then:

```bash
paddy gateway
```

Skip onboard: `bash -s -- --no-onboard`. Help: `bash -s -- --help`.

## Zip kit

```bash
unzip paddy-selfhost.zip
cd paddy-selfhost
npm install            # puts `paddy` on PATH (~/.local/bin)
paddy onboard
paddy gateway
```

In another terminal:

```bash
paddy dashboard        # web console
paddy chat "remember I prefer terse replies"
paddy models
paddy doctor
```

`paddy gateway start` backgrounds it; `stop` / `restart` / `status` match. The command is `paddy` — never npx.

Open the URL the gateway prints (default http://127.0.0.1:8080). Prefer a model in **Models**, or `paddy models prefer laguna`. Keys and session tokens in the UI stay in that browser’s localStorage. **The CLI spends the gateway’s environment** (`selfhost.env`) — sign-in in the dashboard is for the browser.

`--port` and `--host` override the default `127.0.0.1:8080`.

## CLI

| Command | What it does |
|---|---|
| `paddy gateway` | Run the gateway in the foreground |
| `paddy gateway start` | Start in the background (`~/.paddy/gateway.pid`) |
| `paddy gateway stop` / `restart` / `status` | Control the background process |
| `paddy chat` | Interactive REPL against the running gateway |
| `paddy chat "…"` | One-shot turn |
| `paddy dashboard` | Open the web console |
| `paddy models` / `paddy models prefer <id>` | List / pick a brain |
| `paddy doctor` | Check node, kit, env, gateway |
| `paddy onboard` | Write `~/.paddy` and `selfhost.env` |
| `paddy agent list` | Seed mind is Paddy; extras are added in the dashboard |

Config lives in `~/.paddy/config.json`. Chat history for the CLI lives in `~/.paddy/workspace.json` (separate from the browser workspace).

`npm run dev` still works if you want Vite directly. Prefer `paddy gateway` so the CLI token is injected and `paddy chat` can reach `/api/cli`.

## Environment

| Variable | Provider |
|---|---|
| `XAI_API_KEY` | SuperGrok API key (or Sign in with SuperGrok in Models) |
| `OPENAI_API_KEY` | OpenAI API (fallback if you do not sign in with ChatGPT) |
| `CHATGPT_ACCESS_TOKEN` / `CHATGPT_REFRESH_TOKEN` | Optional Codex session (or sign in via Models) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `ANTHROPIC_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN` | Claude setup-token / Claude Code oauth |
| `GOOGLE_API_KEY` or `GEMINI_API_KEY` | Gemini (free AI Studio key is enough) |
| `POOLSIDE_API_KEY` | Laguna S / XS (free Poolside key) |
| `OPENROUTER_API_KEY` | OpenRouter |
| `DEEPSEEK_API_KEY` | DeepSeek official API (not the free chat login) |
| `OLLAMA_HOST` | default `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | default `llama3.2` |
| `PADDY_CLI_TOKEN` | Set automatically by `paddy gateway` |
| `PADDY_MODEL` | Preferred provider id |
| `PADDY_HOME` | Override `~/.paddy` |

Never commit keys. Never paste them into the console chat.

## What is real

- **SuperGrok / X Premium+** — Sign in with SuperGrok (device code) in Models. API key still works as a fallback. CLI uses `XAI_API_KEY`.
- **ChatGPT Plus / Pro** — Sign in with ChatGPT (device code) in Models. Enable device-code in ChatGPT → Settings → Security. CLI uses `OPENAI_API_KEY` or `CHATGPT_ACCESS_TOKEN`.
- **Claude Pro / Max** — paste a token from `claude setup-token`, or an API key. Anthropic does not allow third-party Claude.ai login. CLI uses `ANTHROPIC_TOKEN` / `ANTHROPIC_API_KEY`.
- **Gemini** — free Google AI Studio key, or a Pro/Ultra key. Google does not allow third-party Gemini CLI login.
- **Laguna** — free Poolside models (S or XS). Get a key at platform.poolside.ai.
- **Ollama** — first-class on this machine. The hosted preview cannot see your localhost.
- **Skills hub** — local catalog, not the live ClawHub/Hermes registries.
- **Workspace** — browser localStorage (`paddy-harness-v1`); CLI workspace is `~/.paddy/workspace.json`.

## Models

Open **Models**, sign in or paste a token, **Save & prefer**, then **Test**. The live brain in the console is the preferred provider. The CLI’s preferred brain is `paddy models prefer <id>` plus env keys.

## License

MIT — see `LICENSE`.
