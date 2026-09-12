#!/usr/bin/env bash
# Run ON the Vultr instance (Debian 12/13 or Ubuntu 22.04/24.04), as root:
#   curl -sL <raw url of this file> | bash -s -- <hostname>
#   or:  scp scripts/vultr-setup.sh root@<ip>:/root/ && ssh root@<ip> bash /root/vultr-setup.sh <hostname>
#
# Vultr is the HTTPS FRONT DOOR only. The game server, K2 and the board run on the
# laptop and reach this box over an SSH reverse tunnel (scripts/vultr-tunnel.sh).
# Why: a cheap VPS cannot run K2's reasoning fast enough, and this keeps one brain.
#
# <hostname>: a real domain pointed at this IP (A record), e.g. midnight.yourname.tech
#             fallback with no domain:  <ip-with-dashes>.sslip.io  e.g. 45-77-1-2.sslip.io
set -euo pipefail
HOST="${1:?usage: vultr-setup.sh <hostname>}"
TUNNEL_PORT="${TUNNEL_PORT:-8080}"

echo "== caddy (automatic HTTPS via Let's Encrypt) =="
apt-get update -qq
# Debian does not ship ufw (Ubuntu does); install it explicitly so the firewall step works on both
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl ufw gnupg >/dev/null
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq && apt-get install -y -qq caddy >/dev/null

echo "== firewall: 22, 80, 443 only =="
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "== sshd: allow the reverse tunnel to bind =="
grep -q '^GatewayPorts' /etc/ssh/sshd_config && sed -i 's/^GatewayPorts.*/GatewayPorts no/' /etc/ssh/sshd_config || echo 'GatewayPorts no' >> /etc/ssh/sshd_config
grep -q '^ClientAliveInterval' /etc/ssh/sshd_config || echo 'ClientAliveInterval 30' >> /etc/ssh/sshd_config
systemctl restart ssh 2>/dev/null || systemctl restart sshd

echo "== Caddyfile: $HOST -> localhost:$TUNNEL_PORT (websockets pass through) =="
cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
    encode gzip
    reverse_proxy localhost:$TUNNEL_PORT {
        # the game server hangs on its own health endpoint being wrong; don't
        header_up Host {host}
        header_up X-Forwarded-Proto {scheme}
    }
}
CADDY
systemctl enable caddy >/dev/null
systemctl restart caddy
sleep 3
systemctl is-active caddy && echo "  caddy up" || { echo "  caddy FAILED"; journalctl -u caddy --no-pager | tail -20; exit 1; }

echo
echo "  DONE. Front door is https://$HOST"
echo "  Now, on the LAPTOP:  ./scripts/vultr-tunnel.sh root@$(curl -s ifconfig.me 2>/dev/null || echo '<this-ip>') $HOST"
