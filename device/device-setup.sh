#!/bin/bash
# Runs ON the Chromebook as root (piped over SSH by the Mac): makes it testable without a person at it.
#   ssh root@<ip> '/bin/bash -s awake' < device-setup.sh        (also: diagnose | status | restore)
# Needs a test Chromebook in developer mode with debugging features on. Never on a child's device.
# diagnose  what happened around the last stall (power manager, sshd, kernel)
# awake     never dim, turn the screen off or sleep on idle (powerd prefs), and report "user active" every 30 s
# cut N     no internet and no pilot server for N seconds, then undone BY THE DEVICE ITSELF (dead-man switch):
#           Wi-Fi stays up, so the Mac keeps SSH; if the Mac loses the device anyway, the rules still go away
# restore   undo a cut now
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAC=${MAC_IP:-}   # the machine running server.mjs (only used by the retired 'cut')
LAN=$(ip -4 route show dev wlan0 2>/dev/null | awk '/proto kernel/ {print $1; exit}')
LAN=${LAN:-${LAN_CIDR:-192.168.0.0/16}}

rules() {   # $1 = -I or -D
  iptables "$1" OUTPUT -p tcp -d "$MAC" --dport 8791 -j REJECT -m comment --comment cbpilot 2>/dev/null
  iptables "$1" OUTPUT ! -d "$LAN" -j REJECT -m comment --comment cbpilot 2>/dev/null
}
restore() { while iptables -S OUTPUT | grep -q cbpilot; do rules -D || break; done; echo "restored (cbpilot rules left: $(iptables -S OUTPUT | grep -c cbpilot))"; }

case "$1" in
  diagnose)
    echo "== boots"; last -x 2>/dev/null | head -5
    echo "== powerd: suspend/resume/dark resume (latest log)"; grep -h -i -E "suspend|resum|dark|idle|screen.*off|lid" /var/log/power_manager/powerd.PREVIOUS /var/log/power_manager/powerd.LATEST 2>/dev/null | tail -25
    echo "== sshd"; grep -h -i "sshd" /var/log/messages* 2>/dev/null | tail -15
    echo "== memory pressure / OOM"; grep -h -i -E "oom|out of memory|low.memory|tab discard" /var/log/messages* 2>/dev/null | tail -10
    ;;
  awake)
    mkdir -p /var/lib/power_manager
    for p in plugged_dim_ms plugged_quick_dim_ms plugged_off_ms plugged_suspend_ms unplugged_dim_ms unplugged_quick_dim_ms unplugged_off_ms unplugged_suspend_ms; do echo 0 > /var/lib/power_manager/$p; done
    echo 1 > /var/lib/power_manager/disable_idle_suspend
    echo 1 > /var/lib/power_manager/ignore_external_policy
    restart powerd >/dev/null 2>&1 || (stop powerd; start powerd)
    # Belt and braces: tell powerd a user is active every 30 s while the pilot runs (what a keypress does).
    pkill -f cbpilot-awake 2>/dev/null
    setsid nohup bash -c 'exec -a cbpilot-awake bash -c "while :; do dbus-send --system --type=method_call --dest=org.chromium.PowerManager /org/chromium/PowerManager org.chromium.PowerManager.HandleUserActivity int32:0 >/dev/null 2>&1; sleep 30; done"' >/dev/null 2>&1 < /dev/null &
    echo "awake: prefs $(ls /var/lib/power_manager | tr '\n' ' '); activity pinger pid $(pgrep -f cbpilot-awake | head -1)"
    ;;
  cut)
    # NOT USED ANY MORE for tests: on 28 and 30 Oct these rules made the device unreachable over SSH from the LAN
    # (the Mac's own session dropped). Offline tests now cut the pilot SERVER (pilot/OFFLINE) and set the browser
    # offline over CDP instead. Kept for reference; if ever used, the undo timer starts BEFORE the rules go in.
    N=${2:-300}
    setsid nohup bash -c "sleep $N; while iptables -S OUTPUT | grep -q cbpilot; do iptables -D OUTPUT -p tcp -d $MAC --dport 8791 -j REJECT -m comment --comment cbpilot 2>/dev/null || iptables -D OUTPUT ! -d $LAN -j REJECT -m comment --comment cbpilot 2>/dev/null || break; done" >/dev/null 2>&1 < /dev/null &
    restore >/dev/null; rules -I
    echo "cut for ${N}s (LAN $LAN kept; undo timer pid $!)"
    ;;
  restore) restore ;;
  status)
    echo "uptime $(cut -d' ' -f1 /proc/uptime)s; cbpilot rules: $(iptables -S OUTPUT | grep -c cbpilot); awake pinger: $(pgrep -f cbpilot-awake | head -1 || echo none)"
    echo "guest session: $(tr '\0' ' ' < /proc/$(pgrep -o -f '^/opt/google/chrome/chrome ')/cmdline 2>/dev/null | grep -c -- --bwsi)"
    ;;
esac
