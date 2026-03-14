/**
 * File Integrity Service
 *
 * Verifies downloaded model files using SHA-256 hashes from HuggingFace LFS metadata.
 * Reads files in chunks to avoid loading entire multi-GB models into memory.
 */

import RNFS from 'react-native-fs';
import logger from '../utils/logger';

const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks

/** SHA-256 constants */
const K = [
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

/* eslint-disable no-bitwise */
const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));

/** Incremental SHA-256 hasher for processing large files in chunks */
class SHA256Hasher {
  private h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  private buffer: number[] = [];
  private totalLength = 0;

  /** Process a 512-bit (64-byte) block */
  private processBlock(block: number[]): void {
    const w = new Array<number>(64);
    for (let i = 0; i < 16; i++) {
      const base = i * 4;
      w[i] = (block[base] << 24) | (block[base + 1] << 16) |
             (block[base + 2] << 8) | block[base + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, h] = this.h;

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

    this.h[0] = (this.h[0] + a) | 0;
    this.h[1] = (this.h[1] + b) | 0;
    this.h[2] = (this.h[2] + c) | 0;
    this.h[3] = (this.h[3] + d) | 0;
    this.h[4] = (this.h[4] + e) | 0;
    this.h[5] = (this.h[5] + f) | 0;
    this.h[6] = (this.h[6] + g) | 0;
    this.h[7] = (this.h[7] + h) | 0;
  }

  /** Feed data chunk (as base64 string from RNFS.read) */
  update(base64Data: string): void {
    const bytes = base64ToBytes(base64Data);
    this.totalLength += bytes.length;
    this.buffer.push(...bytes);

    // Process complete 64-byte blocks
    while (this.buffer.length >= 64) {
      this.processBlock(this.buffer.splice(0, 64));
    }
  }

  /** Finalize and return hex digest */
  digest(): string {
    const bitLen = this.totalLength * 8;
    // Padding
    this.buffer.push(0x80);
    while ((this.buffer.length % 64) !== 56) {
      this.buffer.push(0);
    }
    // Append length as 64-bit big-endian
    // For files under 512MB, high 32 bits are always 0
    for (let i = 24; i >= 0; i -= 8) {
      this.buffer.push((Math.floor(bitLen / 0x100000000) >>> i) & 0xff);
    }
    for (let i = 24; i >= 0; i -= 8) {
      this.buffer.push((bitLen >>> i) & 0xff);
    }

    // Process remaining blocks
    while (this.buffer.length >= 64) {
      this.processBlock(this.buffer.splice(0, 64));
    }

    const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
    return this.h.map(toHex).join('');
  }
}
/* eslint-enable no-bitwise */

/** Convert base64 string to byte array */
function base64ToBytes(base64: string): number[] {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];

  let i = 0;
  while (i < base64.length) {
    const a = chars.indexOf(base64[i++]);
    const b = chars.indexOf(base64[i++]);
    const c = chars.indexOf(base64[i++]);
    const d = chars.indexOf(base64[i++]);

    /* eslint-disable no-bitwise */
    bytes.push((a << 2) | (b >> 4));
    if (c !== -1 && base64[i - 2] !== '=') {
      bytes.push(((b & 0x0f) << 4) | (c >> 2));
    }
    if (d !== -1 && base64[i - 1] !== '=') {
      bytes.push(((c & 0x03) << 6) | d);
    }
    /* eslint-enable no-bitwise */
  }

  return bytes;
}

export interface IntegrityResult {
  valid: boolean;
  computedHash: string;
  expectedHash: string;
  filePath: string;
}

/**
 * Compute SHA-256 hash of a file by reading in chunks.
 * Suitable for large model files (multi-GB).
 */
export async function computeFileHash(filePath: string): Promise<string> {
  const exists = await RNFS.exists(filePath);
  if (!exists) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = await RNFS.stat(filePath);
  const fileSize = typeof stat.size === 'string' ? parseInt(stat.size, 10) : stat.size;
  const hasher = new SHA256Hasher();

  let offset = 0;
  while (offset < fileSize) {
    const length = Math.min(CHUNK_SIZE, fileSize - offset);
    const chunk = await RNFS.read(filePath, length, offset, 'base64');
    hasher.update(chunk);
    offset += length;
  }

  return hasher.digest();
}

/**
 * Verify file integrity against an expected SHA-256 hash.
 * Returns detailed result including the computed hash.
 */
export async function verifyFileIntegrity(
  filePath: string,
  expectedHash: string
): Promise<IntegrityResult> {
  try {
    const computedHash = await computeFileHash(filePath);
    const valid = computedHash.toLowerCase() === expectedHash.toLowerCase();

    if (!valid) {
      logger.warn(
        `[FileIntegrity] Hash mismatch for ${filePath}: ` +
        `expected ${expectedHash.slice(0, 16)}..., got ${computedHash.slice(0, 16)}...`
      );
    } else {
      logger.log(`[FileIntegrity] Verified: ${filePath.split('/').pop()}`);
    }

    return { valid, computedHash, expectedHash, filePath };
  } catch (error) {
    logger.error(`[FileIntegrity] Failed to verify ${filePath}:`, error);
    return {
      valid: false,
      computedHash: '',
      expectedHash,
      filePath,
    };
  }
}

export const fileIntegrityService = {
  computeFileHash,
  verifyFileIntegrity,
};
