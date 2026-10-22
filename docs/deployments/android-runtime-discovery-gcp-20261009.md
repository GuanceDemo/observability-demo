# GCP Android runtime discovery recovery

On 2026-10-09, the emulator was online over ADB but the latest-video bridge
repeatedly failed with `StopIteration` while looking for `avd/running/pid_*.ini`.
The emulator boot log from 2026-09-29 22:30 UTC showed permission denied creating
`/run/user/1002/avd/running`. The user runtime directory became available later.

The emulator system unit now requires and starts after `user-runtime-dir@1002.service`.
The video bridge explicitly depends on the emulator and waits up to 180 seconds
for a discovery file with a live PID, port 8554 and a nonempty token. Tokens are
never logged. The existing launcher already waits for discovery.

Deployed only the bridge, discovery helper and two system units to GCP.
Backups: `/opt/mall-demo-webrtc/backups/runtime-discovery-20261009/`.
Restarted emulator, gateway and video service; Android application data retained.
APK remains 2.3.32; no Java images, Helm release, RUM version or SourceMaps changed.

Validation: 8 discovery/video tests passed in the GCP Python environment;
ADB boot completed; video service restart count remained zero; browser received
live Android frames and displayed the bookstore homepage. Existing idle return-to-home
policy is retained. A full VM reboot was not performed.
