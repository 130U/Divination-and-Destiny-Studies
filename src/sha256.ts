import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Same UTF-8 SHA-256 input and lowercase hex output in Node and browsers. */
export function sha256Hex(value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}
