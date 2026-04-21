/**
 * AuthService — Keychain-backed lockout state.
 *
 * The lockout counter and timestamp must live in Keychain so an attacker who clears
 * AsyncStorage (e.g. `adb shell pm clear ai.offgridmobile.dev`) cannot reset the
 * lockout to keep brute-forcing the passphrase.
 */

jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(() => Promise.resolve(true)),
  getGenericPassword: jest.fn(() => Promise.resolve(false)),
  resetGenericPassword: jest.fn(() => Promise.resolve(true)),
  getSupportedBiometryType: jest.fn(() => Promise.resolve(null)),
  ACCESSIBLE: {
    WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
  },
  ACCESS_CONTROL: {
    BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BiometryAnyOrDevicePasscode',
  },
  BIOMETRY_TYPE: {
    FACE_ID: 'FaceID',
    TOUCH_ID: 'TouchID',
    FINGERPRINT: 'Fingerprint',
    FACE: 'Face',
    IRIS: 'Iris',
  },
}));

import { authService } from '../../../src/services/authService';
import * as Keychain from 'react-native-keychain';

const LOCKOUT_SERVICE = 'ai.offgridmobile.auth.lockout';

describe('AuthService — lockout state in Keychain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('readLockoutState', () => {
    it('returns defaults when no record exists', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);

      const state = await authService.readLockoutState();

      expect(state).toEqual({ failedAttempts: 0, lockoutUntil: null });
    });

    it('parses JSON-encoded record from Keychain', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'lockout_state',
        password: JSON.stringify({ failedAttempts: 4, lockoutUntil: 1700000000000 }),
        service: LOCKOUT_SERVICE,
      });

      const state = await authService.readLockoutState();

      expect(state).toEqual({ failedAttempts: 4, lockoutUntil: 1700000000000 });
    });

    it('returns defaults on malformed JSON', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'lockout_state',
        password: 'not-json',
        service: LOCKOUT_SERVICE,
      });

      const state = await authService.readLockoutState();

      expect(state).toEqual({ failedAttempts: 0, lockoutUntil: null });
    });

    it('returns defaults if Keychain throws', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockRejectedValue(new Error('boom'));

      const state = await authService.readLockoutState();

      expect(state).toEqual({ failedAttempts: 0, lockoutUntil: null });
    });
  });

  describe('writeLockoutState', () => {
    it('persists state to Keychain with WHEN_UNLOCKED accessibility', async () => {
      (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);

      await authService.writeLockoutState({ failedAttempts: 3, lockoutUntil: 1700000000000 });

      expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
      const args = (Keychain.setGenericPassword as jest.Mock).mock.calls[0];
      expect(args[0]).toBe('lockout_state');
      expect(JSON.parse(args[1])).toEqual({ failedAttempts: 3, lockoutUntil: 1700000000000 });
      expect(args[2]).toMatchObject({
        service: LOCKOUT_SERVICE,
        accessible: 'AccessibleWhenUnlocked',
      });
    });

    it('swallows Keychain errors so auth flow continues', async () => {
      (Keychain.setGenericPassword as jest.Mock).mockRejectedValue(new Error('write failed'));

      await expect(
        authService.writeLockoutState({ failedAttempts: 1, lockoutUntil: null })
      ).resolves.toBeUndefined();
    });
  });

  describe('resetLockoutState', () => {
    it('clears the Keychain record', async () => {
      (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

      await authService.resetLockoutState();

      expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: LOCKOUT_SERVICE });
    });
  });

  describe('removePassphrase', () => {
    it('also resets the lockout state', async () => {
      (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

      await authService.removePassphrase();

      // Once for the passphrase service, once for the biometric service, once for lockout.
      const services = (Keychain.resetGenericPassword as jest.Mock).mock.calls.map(
        (call) => call[0].service,
      );
      expect(services).toEqual(
        expect.arrayContaining([LOCKOUT_SERVICE]),
      );
    });
  });
});
