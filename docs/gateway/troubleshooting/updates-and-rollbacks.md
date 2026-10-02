---
summary: "Symptoms that appear after an update, a rollback, or a split-brain install of the Gateway"
title: "Updates and rollbacks"
sidebarTitle: "Updates and rollbacks"
read_when:
  - An update finished and the Gateway is down, channels are empty, or model calls return 401
  - Logs report a protocol mismatch, a newer-config guard, or a prepared model runtime timeout
  - You need to tell a version-drift problem apart from a runtime fault
---

## After an update

Use when an update finishes but the Gateway is down, channels are empty, or model calls fail with 401s.

```bash
paddy status --all
paddy update status --json
paddy gateway status --deep
paddy doctor --fix
paddy gateway restart
```

Look for:

- `Update restart` in `paddy status` / `paddy status --all`. Pending or failed handoffs include the next command to run.
- `plugin load failed: dependency tree corrupted; run paddy doctor --fix` under Channels: the channel config still exists, but plugin registration failed before the channel could load.
- Provider 401s after re-auth: `paddy doctor --fix` checks for stale per-agent OAuth auth shadows and removes old copies so all agents resolve the current shared profile.

## Prepared model runtime publication timeout

If startup reports `prepared model runtime publication (...) timed out`, the
parenthesized detail identifies the pending stage and, during workspace
preparation, its agent. Collect that error together with
`paddy gateway status --deep` and the startup logs.

An `ambient credentials` stage can be waiting for a plugin's external login
check even when the Gateway process uses little CPU. For Claude CLI, run
`claude auth status --json` as the Gateway user with the same environment.
Startup shares this check across workspaces; a large roster should not launch
one native-login subprocess per agent. A successful `/health` response alone
does not establish that model runtime publication completed.

## Split brain installs and newer config guard

Use when a gateway service unexpectedly stops after an update, or logs show one `openclaw` binary is older than the version that last wrote `openclaw.json`.

Paddy stamps config writes with `meta.lastTouchedVersion`. Read-only commands can inspect a config written by a newer Paddy, but process and service mutations refuse to run from an older binary. Blocked actions: gateway service start/stop/restart/uninstall, forced service reinstall, service-mode gateway startup, and `gateway --force` port cleanup.

```bash
which paddy
paddy --version
paddy gateway status --deep
paddy config get meta.lastTouchedVersion
```

<Steps>
  <Step title="Fix PATH">
    Fix `PATH` so `openclaw` resolves to the newer install, then rerun the action.
  </Step>
  <Step title="Reinstall the gateway service">
    Reinstall the intended gateway service from the newer install:

    ```bash
    paddy gateway install --force
    paddy gateway restart
    ```

  </Step>
  <Step title="Remove stale wrappers">
    Remove stale system package or old wrapper entries that still point at an old `openclaw` binary.
  </Step>
</Steps>

<Warning>
For an intentional downgrade, follow [Downgrade](/install/updating#downgrade).
Use the managed compatibility checks or restore the verified pre-update backup
with its matching release. Do not remove `meta.lastTouchedVersion` or override
the guard to run older code against migrated state.
</Warning>

## Protocol mismatch after rollback

Use when logs keep printing `protocol mismatch` after a downgrade or rollback. An older Gateway is running, but a newer local client process is still reconnecting with a protocol range the older Gateway cannot speak.

```bash
paddy --version
which -a paddy
paddy gateway status --deep
paddy doctor --deep
paddy logs --follow
```

Look for:

- `protocol mismatch ... client=... v<version> min=<n> max=<n> expected=<n>` in Gateway logs.
- `Established clients:` in `paddy gateway status --deep` or `Gateway clients` in `paddy doctor --deep`: active TCP clients connected to the Gateway port, with PIDs and command lines when the OS allows it.
- A client process whose command line points at the newer Paddy install or wrapper you rolled back from.

Fix:

1. Stop or restart the stale Paddy client process shown by `gateway status --deep`.
2. Restart apps or wrappers that embed Paddy: local dashboards, editors, app-server helpers, or long-running `paddy logs --follow` shells.
3. Re-run `paddy gateway status --deep` or `paddy doctor --deep` and confirm the stale client PID is gone.

Do not make an older Gateway accept a newer incompatible protocol. Protocol bumps protect the wire contract; rollback recovery is a process/version cleanup problem.
