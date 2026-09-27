#!/usr/bin/env bash
set -euo pipefail

# Docker gives this container a private cgroup namespace. Never bind the host hierarchy.
[ "$(cat /proc/self/cgroup)" = "0::/" ]
mount -o remount,rw /sys/fs/cgroup
mkdir /sys/fs/cgroup/openclaw-gateway.service
service_user=appuser
if [ "${OPENCLAW_UPGRADE_SURVIVOR_ROOT_MANAGED_VPS:-0}" = 1 ]; then
  service_user=root
fi
chown "$service_user" /sys/fs/cgroup/cgroup.procs /sys/fs/cgroup/openclaw-gateway.service/cgroup.procs
# The fixture needs only process placement after setup, never mount authority.
exec setpriv --reuid="$service_user" --regid="$service_user" --init-groups \
  --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs "$@"
