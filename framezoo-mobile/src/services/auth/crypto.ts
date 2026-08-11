import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { fromByteArray } from 'base64-js';
import nacl from 'tweetnacl';

export interface DerivedAuthKeys {
  seed: Uint8Array;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

function toBase64Url(bytes: Uint8Array) {
  return fromByteArray(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function deriveAuthKeys(password: string): DerivedAuthKeys {
  const seed = pbkdf2(sha256, password, 'mnemonic', {
    c: 2048,
    dkLen: 32,
  });
  const keyPair = nacl.sign.keyPair.fromSeed(seed);

  return {
    seed,
    publicKey: keyPair.publicKey,
    secretKey: keyPair.secretKey,
  };
}

export function encodePublicKey(publicKey: Uint8Array) {
  return toBase64Url(publicKey);
}

export function encodeBytes(bytes: Uint8Array) {
  return fromByteArray(bytes);
}

export function signChallenge(secretKey: Uint8Array, challenge: string) {
  const message = utf8Encode(challenge);
  return toBase64Url(nacl.sign.detached(message, secretKey));
}

function utf8Encode(value: string) {
  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];

  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === '%') {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }

  return new Uint8Array(bytes);
}
