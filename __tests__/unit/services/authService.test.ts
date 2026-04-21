/**
 * AuthService Unit Tests
 *
 * Tests for passphrase management: set, verify, check, remove, and change.
 * Tests for biometric authentication: availability, enable, disable, authenticate.
 * Uses react-native-keychain for secure storage (mocked in jest.setup.ts).
 */

// Override the global keychain mock to include ACCESSIBLE and biometric constants
jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(() => Promise.resolve(true)),
  getGenericPassword: jest.fn(() => Promise.resolve(false)),
  resetGenericPassword: jest.fn(() => Promise.resolve(true)),
  getSupportedBiometryType: jest.fn(() => Promise.resolve(null)),
  ACCESSIBLE: {
    WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
    AFTER_FIRST_UNLOCK: 'AccessibleAfterFirstUnlock',
    ALWAYS: 'AccessibleAlways',
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

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================================================
  // setPassphrase
  // ========================================================================
  describe('setPassphrase', () => {
    it('stores hashed passphrase in keychain and returns true', async () => {
      (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);

      const result = await authService.setPassphrase('mySecret123');

      expect(result).toBe(true);
      expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
      expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
        'passphrase_hash',
        expect.any(String),
        expect.objectContaining({
          service: 'ai.offgridmobile.auth',
        }),
      );
    });

    it('produces a SHA-256 hex hash (64 chars)', async () => {
      let storedHash = '';
      (Keychain.setGenericPassword as jest.Mock).mockImplementation(
        (_key: string, hash: string) => {
          storedHash = hash;
          return Promise.resolve(true);
        },
      );

      await authService.setPassphrase('testPassword');

      // SHA-256 hex output is always 64 characters
      expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hashes for different passphrases', async () => {
      const hashes: string[] = [];
      (Keychain.setGenericPassword as jest.Mock).mockImplementation(
        (_key: string, hash: string) => {
          hashes.push(hash);
          return Promise.resolve(true);
        },
      );

      await authService.setPassphrase('password1');
      await authService.setPassphrase('password2');

      expect(hashes[0]).not.toBe(hashes[1]);
    });

    it('returns false when keychain storage fails', async () => {
      (Keychain.setGenericPassword as jest.Mock).mockRejectedValue(
        new Error('Keychain unavailable'),
      );

      const result = await authService.setPassphrase('mySecret123');

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // verifyPassphrase
  // ========================================================================
  describe('verifyPassphrase', () => {
    it('returns true when passphrase matches stored hash', async () => {
      let storedHash = '';
      (Keychain.setGenericPassword as jest.Mock).mockImplementation(
        (_key: string, hash: string) => {
          storedHash = hash;
          return Promise.resolve(true);
        },
      );

      await authService.setPassphrase('correctPassphrase');

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: storedHash,
        service: 'ai.offgridmobile.auth',
      });

      const result = await authService.verifyPassphrase('correctPassphrase');

      expect(result).toBe(true);
    });

    it('returns false when passphrase does not match stored hash', async () => {
      let storedHash = '';
      (Keychain.setGenericPassword as jest.Mock).mockImplementation(
        (_key: string, hash: string) => {
          storedHash = hash;
          return Promise.resolve(true);
        },
      );

      await authService.setPassphrase('correctPassphrase');

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: storedHash,
        service: 'ai.offgridmobile.auth',
      });

      const result = await authService.verifyPassphrase('wrongPassphrase');

      expect(result).toBe(false);
    });

    it('returns false when no credentials are stored', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);

      const result = await authService.verifyPassphrase('anyPassphrase');

      expect(result).toBe(false);
    });

    it('returns false when keychain retrieval fails', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockRejectedValue(
        new Error('Keychain error'),
      );

      const result = await authService.verifyPassphrase('anyPassphrase');

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // hasPassphrase
  // ========================================================================
  describe('hasPassphrase', () => {
    it('returns true when credentials exist in keychain', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: 'somehash',
        service: 'ai.offgridmobile.auth',
      });

      const result = await authService.hasPassphrase();

      expect(result).toBe(true);
      expect(Keychain.getGenericPassword).toHaveBeenCalledWith({
        service: 'ai.offgridmobile.auth',
      });
    });

    it('returns false when no credentials exist', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);

      const result = await authService.hasPassphrase();

      expect(result).toBe(false);
    });

    it('returns false when keychain check fails', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockRejectedValue(
        new Error('Keychain error'),
      );

      const result = await authService.hasPassphrase();

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // removePassphrase
  // ========================================================================
  describe('removePassphrase', () => {
    it('resets keychain credentials and disables biometric', async () => {
      (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

      const result = await authService.removePassphrase();

      expect(result).toBe(true);
      // Should reset both auth and biometric services
      expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
        service: 'ai.offgridmobile.auth',
      });
      expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
        service: 'ai.offgridmobile.biometric',
      });
    });

    it('returns false when keychain reset fails', async () => {
      (Keychain.resetGenericPassword as jest.Mock).mockRejectedValue(
        new Error('Keychain error'),
      );

      const result = await authService.removePassphrase();

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // changePassphrase
  // ========================================================================
  describe('changePassphrase', () => {
    it('changes passphrase when old passphrase is correct', async () => {
      let storedHash = '';
      (Keychain.setGenericPassword as jest.Mock).mockImplementation(
        (_key: string, hash: string) => {
          storedHash = hash;
          return Promise.resolve(true);
        },
      );

      await authService.setPassphrase('oldPass');

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: storedHash,
        service: 'ai.offgridmobile.auth',
      });

      const result = await authService.changePassphrase('oldPass', 'newPass');

      expect(result).toBe(true);
      expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(2);
    });

    it('returns false when old passphrase is incorrect', async () => {
      let storedHash = '';
      (Keychain.setGenericPassword as jest.Mock).mockImplementation(
        (_key: string, hash: string) => {
          storedHash = hash;
          return Promise.resolve(true);
        },
      );

      await authService.setPassphrase('oldPass');

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: storedHash,
        service: 'ai.offgridmobile.auth',
      });

      const result = await authService.changePassphrase(
        'wrongOldPass',
        'newPass',
      );

      expect(result).toBe(false);
      expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // Biometric Authentication
  // ========================================================================
  describe('biometric authentication', () => {
    describe('isBiometricAvailable', () => {
      it('returns available with biometry type when supported', async () => {
        (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue('FaceID');

        const result = await authService.isBiometricAvailable();

        expect(result.available).toBe(true);
        expect(result.biometryType).toBe('FaceID');
      });

      it('returns unavailable when no biometry is supported', async () => {
        (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue(null);

        const result = await authService.isBiometricAvailable();

        expect(result.available).toBe(false);
        expect(result.biometryType).toBe(null);
      });

      it('returns unavailable on error', async () => {
        (Keychain.getSupportedBiometryType as jest.Mock).mockRejectedValue(new Error('fail'));

        const result = await authService.isBiometricAvailable();

        expect(result.available).toBe(false);
      });
    });

    describe('getBiometricLabel', () => {
      it('returns Face ID for FaceID type', () => {
        expect(authService.getBiometricLabel('FaceID')).toBe('Face ID');
      });

      it('returns Touch ID for TouchID type', () => {
        expect(authService.getBiometricLabel('TouchID')).toBe('Touch ID');
      });

      it('returns Biometric for null type', () => {
        expect(authService.getBiometricLabel(null)).toBe('Biometric');
      });

      it('returns Biometric for unknown type', () => {
        expect(authService.getBiometricLabel('UnknownType')).toBe('Biometric');
      });
    });

    describe('enableBiometric', () => {
      it('stores biometric marker in keychain with biometric access control', async () => {
        (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);

        const result = await authService.enableBiometric();

        expect(result).toBe(true);
        expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
          'biometric_enabled',
          'enabled',
          expect.objectContaining({
            service: 'ai.offgridmobile.biometric',
            accessControl: 'BiometryAnyOrDevicePasscode',
          }),
        );
      });

      it('returns false on error', async () => {
        (Keychain.setGenericPassword as jest.Mock).mockRejectedValue(new Error('fail'));

        const result = await authService.enableBiometric();

        expect(result).toBe(false);
      });
    });

    describe('disableBiometric', () => {
      it('resets biometric keychain and returns true', async () => {
        (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

        const result = await authService.disableBiometric();

        expect(result).toBe(true);
        expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
          service: 'ai.offgridmobile.biometric',
        });
      });
    });

    describe('isBiometricEnabled', () => {
      it('returns true when biometric credentials exist', async () => {
        (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
          username: 'biometric_enabled',
          password: 'enabled',
        });

        const result = await authService.isBiometricEnabled();

        expect(result).toBe(true);
      });

      it('returns false when no biometric credentials', async () => {
        (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);

        const result = await authService.isBiometricEnabled();

        expect(result).toBe(false);
      });
    });

    describe('authenticateWithBiometric', () => {
      it('returns true on successful biometric auth', async () => {
        (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
          username: 'biometric_enabled',
          password: 'enabled',
        });

        const result = await authService.authenticateWithBiometric();

        expect(result).toBe(true);
        expect(Keychain.getGenericPassword).toHaveBeenCalledWith(
          expect.objectContaining({
            service: 'ai.offgridmobile.biometric',
            authenticationPrompt: expect.objectContaining({
              title: 'Unlock Off Grid',
            }),
          }),
        );
      });

      it('returns false when biometric auth fails', async () => {
        (Keychain.getGenericPassword as jest.Mock).mockRejectedValue(
          new Error('User cancelled'),
        );

        const result = await authService.authenticateWithBiometric();

        expect(result).toBe(false);
      });
    });
  });
});
