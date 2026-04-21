import * as Keychain from 'react-native-keychain';
import { Platform } from 'react-native';
import logger from '../utils/logger';

const SERVICE_NAME = 'ai.offgridmobile.auth';
const PASSPHRASE_KEY = 'passphrase_hash';
const BIOMETRIC_SERVICE = 'ai.offgridmobile.biometric';
const BIOMETRIC_KEY = 'biometric_enabled';

/** SHA-256 hash using simple but cryptographically adequate JS implementation */
function sha256(message: string): string {
  // Convert string to UTF-8 byte array
  const encoder = new TextEncoder();
  const data = encoder.encode(message);

  // SHA-256 constants
  const K: number[] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  // Pre-processing: pad message
  const bitLen = data.length * 8;
  const padded: number[] = Array.from(data);
  padded.push(0x80);
  while ((padded.length % 64) !== 56) {
    padded.push(0);
  }
  // Append original length as 64-bit big-endian
  for (let i = 56; i >= 0; i -= 8) {
    padded.push((bitLen >>> i) & 0xff); // eslint-disable-line no-bitwise
  }

  // Initialize hash values
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  /* eslint-disable no-bitwise */
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));

  // Process each 512-bit block
  for (let offset = 0; offset < padded.length; offset += 64) {
    const w = new Array<number>(64);
    for (let i = 0; i < 16; i++) {
      const base = offset + i * 4;
      w[i] = (padded[base] << 24) | (padded[base + 1] << 16) |
             (padded[base + 2] << 8) | padded[base + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3;
    let e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g; g = f; f = e;
      e = (d + temp1) | 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  /* eslint-enable no-bitwise */

  // Convert to hex string
  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0'); // eslint-disable-line no-bitwise
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) +
         toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
}

class AuthService {
  /** Hash passphrase with SHA-256 + salt for secure storage */
  private hashPassphrase(passphrase: string): string {
    const salt = 'offgrid_mobile_v2_salt';
    // Multi-round SHA-256 to add computational cost
    let hash = sha256(salt + passphrase);
    for (let i = 0; i < 10000; i++) {
      hash = sha256(hash + salt);
    }
    return hash;
  }

  async setPassphrase(passphrase: string): Promise<boolean> {
    try {
      const hash = this.hashPassphrase(passphrase);
      await Keychain.setGenericPassword(PASSPHRASE_KEY, hash, {
        service: SERVICE_NAME,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      });
      return true;
    } catch (error) {
      logger.error('Failed to set passphrase:', error);
      return false;
    }
  }

  async verifyPassphrase(passphrase: string): Promise<boolean> {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: SERVICE_NAME,
      });

      if (!credentials) {
        return false;
      }

      const inputHash = this.hashPassphrase(passphrase);
      return inputHash === credentials.password;
    } catch (error) {
      logger.error('Failed to verify passphrase:', error);
      return false;
    }
  }

  async hasPassphrase(): Promise<boolean> {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: SERVICE_NAME,
      });
      return credentials !== false;
    } catch (error) {
      logger.error('Failed to check passphrase:', error);
      return false;
    }
  }

  async removePassphrase(): Promise<boolean> {
    try {
      await Keychain.resetGenericPassword({
        service: SERVICE_NAME,
      });
      await this.disableBiometric();
      return true;
    } catch (error) {
      logger.error('Failed to remove passphrase:', error);
      return false;
    }
  }

  async changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<boolean> {
    const isValid = await this.verifyPassphrase(oldPassphrase);
    if (!isValid) {
      return false;
    }
    return this.setPassphrase(newPassphrase);
  }

  // --- Biometric Authentication ---

  /** Check if biometric authentication is available on device */
  async isBiometricAvailable(): Promise<{ available: boolean; biometryType: string | null }> {
    try {
      const supportedType = await Keychain.getSupportedBiometryType();
      return {
        available: supportedType !== null,
        biometryType: supportedType,
      };
    } catch (error) {
      logger.warn('Failed to check biometric availability:', error);
      return { available: false, biometryType: null };
    }
  }

  /** Get human-readable biometric type name */
  getBiometricLabel(biometryType: string | null): string {
    if (!biometryType) return 'Biometric';
    switch (biometryType) {
      case Keychain.BIOMETRY_TYPE.FACE_ID:
        return 'Face ID';
      case Keychain.BIOMETRY_TYPE.TOUCH_ID:
        return 'Touch ID';
      case Keychain.BIOMETRY_TYPE.FINGERPRINT:
        return Platform.OS === 'android' ? 'Fingerprint' : 'Touch ID';
      case Keychain.BIOMETRY_TYPE.FACE:
        return 'Face Unlock';
      case Keychain.BIOMETRY_TYPE.IRIS:
        return 'Iris';
      default:
        return 'Biometric';
    }
  }

  /** Enable biometric auth by storing a marker in biometric-protected keychain */
  async enableBiometric(): Promise<boolean> {
    try {
      await Keychain.setGenericPassword(BIOMETRIC_KEY, 'enabled', {
        service: BIOMETRIC_SERVICE,
        accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      });
      return true;
    } catch (error) {
      logger.error('Failed to enable biometric auth:', error);
      return false;
    }
  }

  /** Disable biometric auth */
  async disableBiometric(): Promise<boolean> {
    try {
      await Keychain.resetGenericPassword({
        service: BIOMETRIC_SERVICE,
      });
      return true;
    } catch (error) {
      logger.error('Failed to disable biometric auth:', error);
      return false;
    }
  }

  /** Check if biometric auth is currently enabled */
  async isBiometricEnabled(): Promise<boolean> {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: BIOMETRIC_SERVICE,
      });
      return credentials !== false;
    } catch {
      return false;
    }
  }

  /** Authenticate using device biometrics - prompts the user */
  async authenticateWithBiometric(): Promise<boolean> {
    try {
      const result = await Keychain.getGenericPassword({
        service: BIOMETRIC_SERVICE,
        authenticationPrompt: {
          title: 'Unlock Off Grid',
          subtitle: 'Authenticate to access the app',
          cancel: 'Use Passphrase',
        },
      });
      return result !== false;
    } catch (error) {
      logger.warn('Biometric authentication failed:', error);
      return false;
    }
  }
}

export const authService = new AuthService();
