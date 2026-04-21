/**
 * SSRF Hardening Tests
 *
 * Verifies the hardened isPrivateUrl() in tools/handlers blocks the IPv6, cloud-metadata,
 * and `0.0.0.0` cases that the previous implementation missed. These cover the security
 * audit findings that the original SSRF allowlist (limited to localhost/[::1]/RFC-1918
 * IPv4 ranges) was insufficient.
 */

import { executeToolCall } from '../../../../src/services/tools';

const runReadUrl = (url: string) =>
  executeToolCall({ id: 't1', name: 'read_url', arguments: { url } });

describe('read_url — SSRF blocking', () => {
  beforeEach(() => {
    // Default: any unblocked URL would resolve to a successful HTTP fetch. The test asserts
    // that fetch is *not* reached for blocked URLs.
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: jest.fn().mockResolvedValue('<html><body>ok</body></html>'),
    });
  });

  it.each([
    ['IPv6 loopback',          'http://[::1]/'],
    ['IPv6 unspecified',       'http://[::]/'],
    ['IPv6 unique-local',      'http://[fc00::1]/'],
    ['IPv6 link-local',        'http://[fe80::1]/'],
    ['IPv4-mapped private',    'http://[::ffff:127.0.0.1]/'],
    ['0.0.0.0',                'http://0.0.0.0/'],
    ['10.x.x.x',               'http://10.0.0.1/'],
    ['172.16.x.x',             'http://172.16.0.1/'],
    ['192.168.x.x',            'http://192.168.1.1/'],
    ['169.254.x.x AWS meta',   'http://169.254.169.254/latest/meta-data/'],
    ['GCP metadata host',      'http://metadata.google.internal/computeMetadata/v1/'],
    ['Trailing .local',        'http://router.local/'],
    ['Trailing .internal',     'http://api.internal/'],
    ['Trailing .localhost',    'http://something.localhost/'],
    ['file: scheme not http',  'file:///etc/passwd'],
  ])('blocks %s', async (_label, url) => {
    const result = await runReadUrl(url);
    expect(result.error).toBeDefined();
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it('still allows public https URLs', async () => {
    const result = await runReadUrl('https://example.com/');
    expect(result.error).toBeUndefined();
    expect((globalThis as any).fetch).toHaveBeenCalled();
  });
});
