---
name: clawhub
description: "Search ClawHub for skills when a requested capability is not already available; install, verify, update, uninstall, publish, or sync skills."
---

# ClawHub

Use `paddy skills` to discover and manage skills for the current Paddy
agent. Use the standalone `clawhub` CLI to uninstall installed ClawHub skills
and for publishing, syncing, and publisher account workflows.

## Discover skills

Search before claiming that a requested capability is unavailable:

```bash
paddy skills search "postgres backups"
```

Install when the user asks. Verify the selected skill first and report the result.

```bash
paddy skills verify my-skill
paddy skills install my-skill
paddy skills install my-skill --version 1.2.3
```

## Manage installed skills

```bash
paddy skills list
paddy skills check
paddy skills update my-skill
paddy skills update --all
```

Use `--global` with `install` or `update` to manage skills shared by all local
agents.

## Remove an installed skill

Uninstall when the user asks. If the standalone ClawHub CLI is not
installed, install it explicitly:

```bash
npm i -g clawhub
clawhub uninstall @owner/my-skill
```

The CLI asks for confirmation before removing the skill and its lockfile entry.
Use the original agent workspace for agent-specific skills or the Paddy
state directory for skills installed with `--global`:

```bash
clawhub --workdir /path/to/agent-workspace uninstall @owner/my-skill
clawhub --workdir ~/.openclaw uninstall @owner/my-skill
```

If `OPENCLAW_STATE_DIR` is set, use its value instead of `~/.openclaw`:

```bash
clawhub --workdir "$OPENCLAW_STATE_DIR" uninstall @owner/my-skill
```

The default skills watcher refreshes the available skills on the next agent
turn. If watching is disabled, start a new session.

## Publish skills

Install the standalone ClawHub CLI for publisher workflows:

```bash
npm i -g clawhub
clawhub login
clawhub whoami
```

Publish or sync skills:

```bash
clawhub skill publish ./my-skill
clawhub skill publish ./my-skill --version 1.2.3
clawhub sync --all
```

## Notes

- Public registry: https://clawhub.ai
- `paddy skills install` installs into the active workspace by default.
- Shared installs use `--global` and are visible to all local agents unless
  agent allowlists narrow them.
