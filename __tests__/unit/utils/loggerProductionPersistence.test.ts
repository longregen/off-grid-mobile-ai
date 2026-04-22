/**
 * Logger persistence policy.
 *
 * In production builds the logger must NOT persist `log` lines (which can contain
 * conversation excerpts, file paths, model names, and remote-server URLs) to disk.
 * Only `warn` and `error` cross the on-disk boundary. In dev the logger persists
 * everything so issues remain debuggable.
 */

import { __testing } from '../../../src/utils/logger';

const { shouldPersist } = __testing;

describe('logger persistence policy', () => {
  const originalDev = (globalThis as any).__DEV__;

  afterEach(() => {
    (globalThis as any).__DEV__ = originalDev;
  });

  describe('production', () => {
    beforeEach(() => {
      (globalThis as any).__DEV__ = false;
    });

    it('does not persist log() lines', () => {
      expect(shouldPersist('log')).toBe(false);
    });

    it('persists warn() lines', () => {
      expect(shouldPersist('warn')).toBe(true);
    });

    it('persists error() lines', () => {
      expect(shouldPersist('error')).toBe(true);
    });
  });

  describe('development', () => {
    beforeEach(() => {
      (globalThis as any).__DEV__ = true;
    });

    it('persists all levels', () => {
      expect(shouldPersist('log')).toBe(true);
      expect(shouldPersist('warn')).toBe(true);
      expect(shouldPersist('error')).toBe(true);
    });
  });
});
