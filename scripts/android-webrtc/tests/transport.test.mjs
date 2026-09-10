import assert from 'node:assert/strict';
import {test} from 'node:test';
import {playbackTransport} from '../player/transport.ts';
test('relay diagnostics are opt-in and preserve the configured ICE servers', () => {
  const config = {iceServers: [{urls: 'turn:example.test'}]};
  assert.equal(playbackTransport(config, ''), config);
  assert.equal(playbackTransport(config, '?rtcTransport=invalid'), config);
  const relay = playbackTransport(config, '?rtcTransport=relay');
  assert.equal(relay.iceTransportPolicy, 'relay');
  assert.equal(relay.iceServers, config.iceServers);
  assert.equal(config.iceTransportPolicy, undefined);
});
