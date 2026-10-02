---
summary: "CLI reference for `paddy clawbot` (legacy alias namespace)"
read_when:
  - You maintain older scripts using `paddy clawbot ...`
  - You need migration guidance to current commands
title: "Clawbot"
---

# `paddy clawbot`

Legacy alias namespace kept for backward compatibility. It registers the same QR command as the top-level CLI, so `paddy clawbot qr` accepts every [`paddy qr`](/cli/qr) flag. No removal is scheduled; prefer the top-level commands in new scripts.

## Migration

Prefer the modern top-level command:

- `paddy clawbot qr` -> `paddy qr`

## Related

- [CLI reference](/cli)
