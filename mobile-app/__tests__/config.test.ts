import {
  DEFAULT_GATEWAY_URL,
  joinGatewayPath,
  resolveGatewayUrl,
} from '../src/config';

describe('mobile Gateway configuration', () => {
  it('uses the shared observability-demo Gateway by default', () => {
    expect(resolveGatewayUrl(undefined)).toBe(DEFAULT_GATEWAY_URL);
    expect(DEFAULT_GATEWAY_URL).toBe('http://120.79.13.13:31080');
  });

  it('allows platform builds to override and normalize the Gateway', () => {
    expect(resolveGatewayUrl('https://demo.example.com///')).toBe(
      'https://demo.example.com',
    );
    expect(joinGatewayPath(DEFAULT_GATEWAY_URL, '/api/demo/faults')).toBe(
      'http://120.79.13.13:31080/api/demo/faults',
    );
  });
});
