#!/usr/bin/env python3
"""Exercise real MQTT5 denial responses; no secrets or synthetic telemetry output."""
import json
from pathlib import Path
import threading
import uuid
import paho.mqtt.client as mqtt

credentials = json.loads(Path('/etc/vehicle-demo/credentials.json').read_text())


def connect(username=None, password=None, *, rejected=False):
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='vehicle-acl-test-' + uuid.uuid4().hex,
                         protocol=mqtt.MQTTv5, transport='websockets')
    client.ws_set_options(path='/vehicle-mqtt')
    client.tls_set()
    if username:
        client.username_pw_set(username, password)
    done, result = threading.Event(), []
    def connected(_client, _userdata, _flags, reason, _props):
        result.append(reason.is_failure)
        done.set()
    client.on_connect = connected
    client.connect('35.241.68.75.nip.io', 443, 30)
    client.loop_start()
    if not done.wait(15) or result != [rejected]:
        client.disconnect()
        client.loop_stop()
        raise AssertionError('Unexpected MQTT authentication result')
    return client


def close(client):
    client.disconnect()
    client.loop_stop()


for username, password in [(None, None), ('vehicle-publisher', 'deliberately-invalid-password')]:
    close(connect(username, password, rejected=True))
print('PASS: anonymous and invalid credentials rejected over TLS/WSS')
publisher = connect('vehicle-publisher', credentials['publisher'])
done, result = threading.Event(), []
def published(_client, _userdata, _mid, reason, _props):
    result.append(reason.is_failure)
    done.set()
publisher.on_publish = published
publisher.publish('vehicle/v1/other-vehicle/telemetry', b'{}', qos=1)
assert done.wait(15) and result == [True], 'Cross-vehicle publish was not rejected'
close(publisher)
print('PASS: publisher cannot publish another vehicle topic')
observer = connect('vehicle-observer', credentials['observer'])
done, result = threading.Event(), []
def subscribed(_client, _userdata, _mid, reasons, _props):
    result.extend(reason.is_failure for reason in reasons)
    done.set()
observer.on_subscribe = subscribed
observer.subscribe('vehicle/v1/other-vehicle/#', qos=1)
assert done.wait(15) and result == [True], 'Cross-vehicle subscription was not rejected'
done.clear()
result.clear()
observer.on_publish = published
observer.publish('vehicle/v1/demo-vehicle-001/telemetry', b'{}', qos=1)
assert done.wait(15) and result == [True], 'Observer unexpectedly has publish access'
close(observer)
print('PASS: observer cannot subscribe another vehicle or publish telemetry')
