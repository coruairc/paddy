# Paddy Irishman

Irish-roots super harness. Gateway presence plus a closed learning loop.

Not affiliated with the OpenClaw Foundation, Nous Research, Guinness, or Paddy Irish Whiskey.

## Install

Same shape as the usual harness installers.

macOS / Linux / WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/coruairc/paddy/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/coruairc/paddy/main/install.ps1 | iex
```

Skip the onboard wizard:

```bash
curl -fsSL https://raw.githubusercontent.com/coruairc/paddy/main/install.sh | bash -s -- --no-onboard
```

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/coruairc/paddy/main/install.ps1))) -NoOnboard
```

Needs **git** and **Node.js 22+**. No sudo. The script clones this repo to `~/.paddy/src`, runs `npm install`, and puts `paddy` on your PATH.

## Then

```bash
paddy gateway              # control plane (foreground)
paddy gateway start        # background
paddy dashboard            # web console
paddy chat "hello"
paddy models
paddy models prefer laguna
paddy skills
paddy memory
paddy doctor
```

Put keys or setup-tokens in `~/.paddy/src/selfhost.env` (copy `selfhost.env.example`) or `~/.paddy/selfhost.env`. Sign-in in the dashboard is for the browser; the CLI spends the gateway environment.

## Manual

```bash
git clone https://github.com/coruairc/paddy.git
cd paddy
npm install          # puts `paddy` on PATH
paddy onboard
paddy gateway
```

## License

MIT — see [LICENSE](LICENSE).
