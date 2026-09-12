#!/usr/bin/env bash
# ONE COMMAND after the instance is deployed:
#   ./scripts/vultr-go.sh <vultr-ip> [hostname]
# No hostname -> uses <ip-with-dashes>.sslip.io (needs no DNS setup; Let's Encrypt works).
# Sets up Caddy on the box, then starts K2 + the game + the reverse tunnel from here.
set -uo pipefail
cd "$(dirname "$0")/.."
IP="${1:?usage: vultr-go.sh <ip> [hostname]}"
HOST="${2:-$(echo "$IP" | tr . -).sslip.io}"

echo "== front door: https://$HOST  (box $IP) =="
echo "== waiting for ssh on the new box =="
for i in $(seq 1 30); do
  ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "root@$IP" true 2>/dev/null && break
  sleep 4
done
ssh -o BatchMode=yes -o ConnectTimeout=5 "root@$IP" true 2>/dev/null || { echo "cannot ssh to root@$IP -- is the key you pasted ~/.ssh/id_ed25519.pub?"; exit 1; }

# Re-runs are the normal case (laptop rebooted, terminal closed). Skip the ~1 min
# install when Caddy is already serving this hostname; pass --reinstall to force.
if [ "${3:-}" != "--reinstall" ] && ssh "root@$IP" "systemctl is-active --quiet caddy && grep -q '^$HOST' /etc/caddy/Caddyfile" 2>/dev/null; then
  echo "== box already configured for $HOST (Caddy active) -- skipping install =="
else
  echo "== installing Caddy + firewall on the box (one time, ~1 min) =="
  scp -q scripts/vultr-setup.sh "root@$IP:/root/vultr-setup.sh"
  ssh "root@$IP" "bash /root/vultr-setup.sh $HOST" | tail -6
fi

echo "== starting everything on the laptop and opening the tunnel =="
exec ./scripts/vultr-tunnel.sh "root@$IP" "$HOST"
