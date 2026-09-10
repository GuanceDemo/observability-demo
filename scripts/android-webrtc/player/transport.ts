/** Session-only diagnostic override; preserve normal ICE selection by default. */
export function playbackTransport(config: RTCConfiguration, search: string): RTCConfiguration {
  return new URLSearchParams(search).get('rtcTransport') === 'relay'
    ? {...config, iceTransportPolicy: 'relay'}
    : config;
}
