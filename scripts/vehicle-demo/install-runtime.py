#!/usr/bin/env python3
"""Install additive services on the inspected GCP emulator host (run as root).

Copy this directory to /opt/vehicle-demo and the shared latest-video package to
/opt/vehicle-demo/latest-video first. Existing mall services are never restarted.
"""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path('/opt/vehicle-demo')
STATE = Path('/var/lib/vehicle-demo')
SDK = '/home/cherry/android-sdk'
PYTHON = '/opt/mall-demo-webrtc/latest-video-venv/bin/python'
ENV = '''Environment=HOME=/home/cherry
Environment=XDG_RUNTIME_DIR=/run/user/1002
Environment=ANDROID_ADB=/home/cherry/android-sdk/platform-tools/adb
Environment=ANDROID_SERIAL=emulator-5556
Environment=ANDROID_PACKAGE=com.guance.vehicledemo
Environment=VIDEO_WIDTH=1280
Environment=VIDEO_HEIGHT=720
Environment=VIDEO_FPS=15
Environment=VIDEO_PORT=8092
Environment=VIDEO_GATEWAY_PORT=8082
Environment=VIDEO_GRPC_PORT=8556
Environment=VIDEO_IDLE_ENABLED=false
Environment=VIDEO_MALL_CONTROLS=false
Environment=EMULATOR_ICE_CONFIG=/etc/mall-demo-webrtc/turn.json
'''


def run(command, **kwargs):
    subprocess.run(command, check=True, **kwargs)


def service(name, description, command, *, after='', requires='', root=False, extra=''):
    content = f'''[Unit]
Description={description}
After=network-online.target {after}
Wants=network-online.target
{('Requires=' + requires) if requires else ''}
ConditionPathExists=!/var/lib/vehicle-demo/capacity-stopped
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User={'root' if root else 'cherry'}
Group={'root' if root else 'cherry'}
{ENV}
ExecStart={command}
Restart=on-failure
RestartSec=10
TimeoutStopSec=30
{extra}

[Install]
WantedBy=multi-user.target
'''
    Path(f'/etc/systemd/system/{name}.service').write_text(content)


def ensure_local_broker(pipeline=Path('/etc/vehicle-demo/pipeline.json')):
    if pipeline.exists() and json.loads(pipeline.read_text()).get('broker_ip'):
        return
    run(['python3', str(ROOT / 'prepare-broker.py')])
    run(['docker', 'compose', '-f', str(ROOT / 'compose.yaml'), 'up', '-d'])
    run(['python3', str(ROOT / 'bootstrap-users.py')])


def main():
    if os.getuid() != 0:
        raise SystemExit('Run as root on the target GCP host')
    if not Path(SDK + '/system-images/android-36/google_apis/x86_64/source.properties').exists():
        raise SystemExit('Inspected Android 36 system image is missing')
    STATE.mkdir(mode=0o750, exist_ok=True)
    available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines()
                         if line.startswith('MemAvailable:'))) // 1024
    avd = Path('/home/cherry/.android/avd/VehicleDemo_API36.avd')
    if not avd.exists():
        if available < 5500:
            raise SystemExit('Less than 5500 MiB available before adding the AVD; stop for capacity review')
        run(['runuser', '-u', 'cherry', '--', 'env', 'HOME=/home/cherry',
             SDK + '/cmdline-tools/latest/bin/avdmanager', 'create', 'avd',
             '-n', 'VehicleDemo_API36', '-k', 'system-images;android-36;google_apis;x86_64'], input='no\n', text=True)
        config_path = avd / 'config.ini'
        values = dict(line.split('=', 1) for line in config_path.read_text().splitlines() if '=' in line)
        values.update({'hw.lcd.width': '1280', 'hw.lcd.height': '720', 'hw.lcd.density': '160',
                       'hw.ramSize': '2048', 'hw.cpu.ncore': '4', 'hw.keyboard': 'yes',
                       'hw.mainKeys': 'no', 'skin.name': '1280x720', 'disk.dataPartition.size': '6G'})
        config_path.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
        run(['chown', '-R', 'cherry:cherry', str(avd)])
    ensure_local_broker()
    if not (ROOT / 'observer-venv/bin/python').exists():
        run(['python3', '-m', 'venv', str(ROOT / 'observer-venv')])
    run([str(ROOT / 'observer-venv/bin/pip'), 'install', '--disable-pip-version-check', 'paho-mqtt==2.1.0'])
    service('vehicle-demo-emulator', 'Vehicle dedicated landscape Android emulator',
            SDK + '/emulator/emulator @VehicleDemo_API36 -port 5556 -no-window -no-audio -no-boot-anim '
            # Explicit low-RAM mode prevents Android 36 from raising guest RAM to 2560 MiB.
            '-no-metrics -skin 1280x720 -gpu swiftshader -accel on -cores 4 '
            '-lowram -memory 2048 -no-snapshot '
            '-grpc 8556 -grpc-use-token -grpc-allowlist /etc/mall-demo-webrtc/emulator-access.json '
            '-turncfg "/bin/cat /etc/mall-demo-webrtc/turn.json"',
            after='user-runtime-dir@1002.service', requires='user-runtime-dir@1002.service',
            # Allow concurrent boot services while capping this AVD at half of the host CPUs.
            extra='Environment=ANDROID_SDK_ROOT=' + SDK + '\nEnvironment=ANDROID_AVD_HOME=/home/cherry/.android/avd\nMemoryMax=4096M\nCPUQuota=400%\nRestartPreventExitStatus=SIGKILL')
    service('vehicle-demo-gateway', 'Vehicle native input gateway', f'{PYTHON} {ROOT}/gateway.py',
            after='vehicle-demo-emulator.service', requires='vehicle-demo-emulator.service', extra='MemoryMax=384M')
    service('vehicle-demo-video', 'Vehicle landscape latest frame video', f'{PYTHON} {ROOT}/latest-video/bridge.py',
            after='vehicle-demo-gateway.service', requires='vehicle-demo-gateway.service', extra='MemoryMax=640M\nCPUQuota=150%\nNoNewPrivileges=true')
    service('vehicle-demo-observer', 'Independent MQTT receipt verifier', f'{ROOT}/observer-venv/bin/python {ROOT}/observer.py',
            after='docker.service', root=True, extra='MemoryMax=192M\nNoNewPrivileges=true')
    service('vehicle-demo-watchdog', 'Vehicle capacity and foreground watchdog', f'/usr/bin/python3 {ROOT}/watchdog.py',
            after='vehicle-demo-emulator.service', root=True, extra='MemoryMax=128M')
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'vehicle-demo-emulator', 'vehicle-demo-gateway', 'vehicle-demo-video',
         'vehicle-demo-observer', 'vehicle-demo-watchdog'])
    print('Runtime services and capacity protection installed. Install the APK next.')


if __name__ == '__main__':
    main()
