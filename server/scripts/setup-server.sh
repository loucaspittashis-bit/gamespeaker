#!/bin/sh
# Prepares a fresh Ubuntu 24.04 VPS for Gamespeaker. It does the same as
# cloud-init.yaml, for providers without a "cloud config" box (OVHcloud etc.):
# Docker from Ubuntu's packages, automatic security updates with a 05:00
# reboot window, SSH keys only, fail2ban, and a firewall that opens only the
# ports Gamespeaker needs.
#
# Run it once, over an SSH session that already uses your key:
#   sudo sh setup-server.sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo sh $0" >&2
  exit 1
fi
APP_USER=${SUDO_USER:-ubuntu}

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install docker.io docker-compose-v2 ufw unattended-upgrades fail2ban rsync

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

cat > /etc/apt/apt.conf.d/52gamespeaker-upgrades <<'EOF'
// Reboot at 05:00 server time when an update needs it (kernel etc.).
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "05:00";
EOF

# Keys only. Files in sshd_config.d are read in name order and the first
# value wins, so "10-" beats the provider's "50-cloud-init.conf".
cat > /etc/ssh/sshd_config.d/10-gamespeaker.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF

systemctl enable --now docker
usermod -aG docker "$APP_USER"

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw allow 7881/tcp
ufw allow 7882/udp
ufw --force enable

systemctl enable --now fail2ban
systemctl restart ssh

mkdir -p /opt/gamespeaker
chown "$APP_USER:$APP_USER" /opt/gamespeaker

echo
echo "Server ready. Log out and back in once so '$APP_USER' can use Docker without sudo."
