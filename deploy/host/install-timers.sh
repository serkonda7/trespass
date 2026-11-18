#!/usr/bin/env bash
# Installs nightly upload backup + monthly restore test as systemd timers.
#   sudo ./install-timers.sh   (expects the repo at /opt/trespass)
set -euo pipefail
D=/opt/trespass/deploy
cat > /etc/systemd/system/trespass-backup.service <<UNIT
[Unit]
Description=Trespass restic backup of uploads
After=docker.service
[Service]
Type=oneshot
WorkingDirectory=$D
ExecStart=$D/backup-uploads.sh
UNIT
cat > /etc/systemd/system/trespass-backup.timer <<'UNIT'
[Unit]
Description=Nightly Trespass upload backup
[Timer]
OnCalendar=*-*-* 04:15:00 Europe/Berlin
RandomizedDelaySec=15m
Persistent=true
[Install]
WantedBy=timers.target
UNIT
cat > /etc/systemd/system/trespass-restore-test.service <<UNIT
[Unit]
Description=Trespass monthly restore test
After=docker.service trespass-backup.service
[Service]
Type=oneshot
WorkingDirectory=$D
ExecStart=$D/restore-test.sh
UNIT
cat > /etc/systemd/system/trespass-restore-test.timer <<'UNIT'
[Unit]
Description=Monthly Trespass restore test
[Timer]
OnCalendar=*-*-02 05:00:00 Europe/Berlin
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now trespass-backup.timer trespass-restore-test.timer
systemctl list-timers 'trespass-*'
