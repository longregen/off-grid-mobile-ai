/**
 * File Integrity Service Unit Tests
 *
 * Tests for SHA-256 hash computation and file integrity verification.
 */

jest.mock('react-native-fs', () => ({
  exists: jest.fn(),
  stat: jest.fn(),
  read: jest.fn(),
}));

import RNFS from 'react-native-fs';
import { computeFileHash, verifyFileIntegrity } from '../../../src/services/fileIntegrity';

// Helper: convert string to base64
function toBase64(str: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = Array.from(str).map(c => c.charCodeAt(0));
  let result = '';
  let i = 0;

  while (i < bytes.length) {
    const a = bytes[i++];
    const b = i < bytes.length ? bytes[i++] : undefined;
    const c = i < bytes.length ? bytes[i++] : undefined;

    /* eslint-disable no-bitwise */
    result += chars[a >> 2];
    result += chars[((a & 3) << 4) | ((b ?? 0) >> 4)];
    result += b !== undefined ? chars[((b & 0x0f) << 2) | ((c ?? 0) >> 6)] : '=';
    result += c !== undefined ? chars[c & 0x3f] : '=';
    /* eslint-enable no-bitwise */
  }

  return result;
}

describe('FileIntegrityService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('computeFileHash', () => {
    it('computes SHA-256 hash for a small file', async () => {
      const content = 'hello';
      const base64Content = toBase64(content);

      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      (RNFS.stat as jest.Mock).mockResolvedValue({ size: content.length });
      (RNFS.read as jest.Mock).mockResolvedValue(base64Content);

      const hash = await computeFileHash('/test/file.gguf');

      // SHA-256 of "hello" is well-known
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('returns a 64-char hex string', async () => {
      const content = 'test data for hashing';
      const base64Content = toBase64(content);

      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      (RNFS.stat as jest.Mock).mockResolvedValue({ size: content.length });
      (RNFS.read as jest.Mock).mockResolvedValue(base64Content);

      const hash = await computeFileHash('/test/file.gguf');

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('throws when file does not exist', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(false);

      await expect(computeFileHash('/nonexistent.gguf')).rejects.toThrow('File not found');
    });

    it('produces different hashes for different content', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);

      (RNFS.stat as jest.Mock).mockResolvedValueOnce({ size: 5 });
      (RNFS.read as jest.Mock).mockResolvedValueOnce(toBase64('hello'));

      const hash1 = await computeFileHash('/file1.gguf');

      (RNFS.stat as jest.Mock).mockResolvedValueOnce({ size: 5 });
      (RNFS.read as jest.Mock).mockResolvedValueOnce(toBase64('world'));

      const hash2 = await computeFileHash('/file2.gguf');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyFileIntegrity', () => {
    it('returns valid when hash matches', async () => {
      const content = 'hello';
      const expectedHash = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      (RNFS.stat as jest.Mock).mockResolvedValue({ size: content.length });
      (RNFS.read as jest.Mock).mockResolvedValue(toBase64(content));

      const result = await verifyFileIntegrity('/test/file.gguf', expectedHash);

      expect(result.valid).toBe(true);
      expect(result.computedHash).toBe(expectedHash);
      expect(result.expectedHash).toBe(expectedHash);
    });

    it('returns invalid when hash does not match', async () => {
      const content = 'hello';
      const wrongHash = '0000000000000000000000000000000000000000000000000000000000000000';

      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      (RNFS.stat as jest.Mock).mockResolvedValue({ size: content.length });
      (RNFS.read as jest.Mock).mockResolvedValue(toBase64(content));

      const result = await verifyFileIntegrity('/test/file.gguf', wrongHash);

      expect(result.valid).toBe(false);
      expect(result.computedHash).not.toBe(wrongHash);
    });

    it('handles case-insensitive hash comparison', async () => {
      const content = 'hello';
      const expectedHash = '2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824';

      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      (RNFS.stat as jest.Mock).mockResolvedValue({ size: content.length });
      (RNFS.read as jest.Mock).mockResolvedValue(toBase64(content));

      const result = await verifyFileIntegrity('/test/file.gguf', expectedHash);

      expect(result.valid).toBe(true);
    });

    it('returns invalid when file does not exist', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(false);

      const result = await verifyFileIntegrity('/nonexistent.gguf', 'abc123');

      expect(result.valid).toBe(false);
      expect(result.computedHash).toBe('');
    });
  });
});
