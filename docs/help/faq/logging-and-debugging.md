---
summary: "Where logs are, service start and restart, and what to check when replies never arrive"
title: "Logging and debugging"
read_when:
  - You need logs or a Gateway service restart
  - The Gateway is up but replies never arrive
---

## Logging and debugging

<AccordionGroup>
  <Accordion title="Where are logs?">
    File logs (structured): `/tmp/openclaw/openclaw-YYYY-MM-DD.log` for the default profile, or `/tmp/openclaw/openclaw-<profile>-YYYY-MM-DD.log` for a named profile. Set a stable path via `logging.file`; file log level via `logging.level`; console verbosity via `--verbose` and `logging.consoleLevel`.

    Fastest tail:

    ```bash
    paddy logs --follow
    ```

    Service/supervisor logs (when the gateway runs via launchd/systemd):

    - macOS launchd stdout and stderr: `~/Library/Logs/openclaw/gateway.log` (profiles use `gateway-<profile>.log`; both streams share this file, so startup failures that happen before the logger starts are recorded here too).
    - Linux: `journalctl --user -u openclaw-gateway[-<profile>].service -n 200 --no-pager`.
    - Windows: `schtasks /Query /TN "OpenClaw Gateway (<profile>)" /V /FO LIST`.

    See [Troubleshooting](/gateway/troubleshooting) for more.

  </Accordion>

  <Accordion title="How do I start/stop/restart the Gateway service?">
    ```bash
    paddy gateway status
    paddy gateway restart
    ```

    If you run the gateway manually, `paddy gateway --force` can reclaim the port. See [Gateway](/gateway).

  </Accordion>

  <Accordion title="I closed my terminal on Windows - how do I restart Paddy?">
    Three Windows install modes:

    **1) Windows Hub local setup**: the native app manages a local app-owned WSL Gateway. Open **Paddy Companion** from the Start menu or tray, then use **Gateway Setup** or the Connections tab.

    **2) Manual WSL2 Gateway**: the Gateway runs inside Linux.
    ```powershell
    wsl
    paddy gateway status
    paddy gateway restart
    ```
    If you never installed the service, start it in the foreground: `paddy gateway run`.

    **3) Native Windows CLI/Gateway**: runs directly in Windows.
    ```powershell
    paddy gateway status
    paddy gateway restart
    ```
    If you run it manually (no service): `paddy gateway run`.

    Docs: [Windows](/platforms/windows), [Gateway service runbook](/gateway).

  </Accordion>

  <Accordion title="The Gateway is up but replies never arrive. What should I check?">
    Quick health sweep:

    ```bash
    paddy status
    paddy models status
    paddy channels status
    paddy logs --follow
    ```

    Common causes: model auth not loaded on the **gateway host** (check `models status`), channel pairing/allowlist blocking replies (check channel config and logs), or WebChat/Dashboard open without the right token. If remote, confirm the tunnel/Tailscale connection is up and the Gateway WebSocket is reachable.

    Docs: [Channels](/channels), [Troubleshooting](/gateway/troubleshooting), [Remote access](/gateway/remote).

  </Accordion>

  <Accordion title='"Disconnected from gateway: no reason" - what now?'>
    Usually means the UI lost the WebSocket connection. Check: is the Gateway running (`paddy gateway status`)? Is it healthy (`paddy status`)? Does the UI have the right token (`paddy dashboard`)? If remote, is the tunnel/Tailscale link up?

    Then tail logs:

    ```bash
    paddy logs --follow
    ```

    Docs: [Dashboard](/web/dashboard), [Remote access](/gateway/remote), [Troubleshooting](/gateway/troubleshooting).

  </Accordion>

  <Accordion title="Telegram setMyCommands fails. What should I check?">
    ```bash
    paddy channels status
    paddy channels logs --channel telegram
    ```

    Then match the error:

    - `BOT_COMMANDS_TOO_MUCH`: the Telegram menu has too many entries. Paddy already trims to the Telegram limit and retries with fewer commands, but some menu entries may still be dropped. Reduce plugin/skill/custom commands, or disable `channels.telegram.commands.native` if you do not need the menu.
    - `TypeError: fetch failed`, `Network request for 'setMyCommands' failed!`, or similar network errors: on a VPS or behind a proxy, confirm outbound HTTPS is allowed and DNS works for `api.telegram.org`.

    If the Gateway is remote, check logs on the Gateway host.

    Docs: [Telegram](/channels/telegram), [Channel troubleshooting](/channels/troubleshooting).

  </Accordion>

  <Accordion title="TUI shows no output. What should I check?">
    ```bash
    paddy status
    paddy models status
    paddy logs --follow
    ```

    In the TUI, use `/status` to see the current state. If you expect replies in a chat channel, confirm delivery is enabled (`/deliver on`).

    Docs: [TUI](/web/tui), [Slash commands](/tools/slash-commands).

  </Accordion>

  <Accordion title="How do I completely stop then start the Gateway?">
    If you installed the service (launchd on macOS, systemd on Linux):

    ```bash
    paddy gateway stop
    paddy gateway start
    ```

    In the foreground, stop with Ctrl-C, then `paddy gateway run`.

    Docs: [Gateway service runbook](/gateway).

  </Accordion>

  <Accordion title="ELI5: paddy gateway restart vs paddy gateway">
    `paddy gateway restart` restarts the **background service** (launchd/systemd). `paddy gateway` runs the gateway **in the foreground** for this terminal session. Use the gateway subcommands if you installed the service; use the bare foreground run for a one-off.
  </Accordion>

  <Accordion title="Fastest way to get more details when something fails">
    Start the Gateway with `--verbose` for more console detail, then inspect the log file for channel auth, model routing, and RPC errors.
  </Accordion>
</AccordionGroup>
