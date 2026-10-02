import { gcm } from "@noble/ciphers/aes.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

type Keys = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  seed: Uint8Array;
};

async function seedFromMnemonic(mnemonic: string) {
  return pbkdf2Async(sha256, mnemonic, "mnemonic", {
    c: 2048,
    dkLen: 32,
  });
}

async function seedFromPassword(password: string) {
  return pbkdf2Async(sha256, password, "password", {
    c: 2048,
    dkLen: 32,
  });
}

export function verifyValidMnemonic(mnemonic: string) {
  // First try to validate as BIP39 mnemonic
  if (validateMnemonic(mnemonic, wordlist)) {
    return true;
  }

  // If not a valid BIP39 mnemonic, check if it's a valid custom passphrase
  const validPassphraseRegex =
    /^[a-zA-Z0-9\s\-_.,!?@#$%^&*()+=:;"'<>[\]{}|\\/`~]+$/;
  return mnemonic.length >= 8 && validPassphraseRegex.test(mnemonic);
}

export async function keysFromSeed(seed: Uint8Array): Promise<Keys> {
  if (seed.byteLength !== 32) throw new Error("Seed must be 256-bit");
  const publicKey = ed25519.getPublicKey(seed);
  const privateKey = new Uint8Array(64);
  privateKey.set(seed);
  privateKey.set(publicKey, 32);

  return {
    privateKey: new Uint8Array(privateKey),
    publicKey: new Uint8Array(publicKey),
    seed,
  };
}

export async function keysFromMnemonic(mnemonic: string): Promise<Keys> {
  const seed = await seedFromMnemonic(mnemonic);

  return keysFromSeed(seed);
}

export async function keysFromPassword(password: string): Promise<Keys> {
  const seed = await seedFromPassword(password);

  return keysFromSeed(seed);
}

export function verifyValidPassword(password: string) {
  // Password must be at least 8 characters and contain at least one letter and one digit
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d\W_]{8,}$/;
  return passwordRegex.test(password);
}

export function genMnemonic(): string {
  return generateMnemonic(wordlist);
}

export async function signCode(
  code: string,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  if (privateKey.byteLength < 32) throw new Error("Private key is invalid");
  return ed25519.sign(new TextEncoder().encode(code), privateKey.slice(0, 32));
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\//g, "_")
    .replace(/\+/g, "-")
    .replace(/=+$/, "");
}

export async function signChallenge(keys: Keys, challengeCode: string) {
  const signature = await signCode(challengeCode, keys.privateKey);
  return bytesToBase64Url(signature);
}

export function base64ToBuffer(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function encryptData(data: string, secret: Uint8Array) {
  if (secret.byteLength !== 32)
    throw new Error("Secret must be at least 256-bit");

  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encrypted = gcm(secret, iv).encrypt(new TextEncoder().encode(data));
  const encryptedData = encrypted.slice(0, -16);
  const tag = encrypted.slice(-16);

  return `${bytesToBase64(iv)}.${bytesToBase64(encryptedData)}.${bytesToBase64(
    tag,
  )}` as const;
}

export function decryptData(data: string, secret: Uint8Array) {
  if (secret.byteLength !== 32) throw new Error("Secret must be 256-bit");

  const [iv, encryptedData, tag] = data.split(".");
  if (!iv || !encryptedData || !tag) throw new Error("Invalid encrypted data");

  const ciphertext = new Uint8Array([
    ...base64ToBuffer(encryptedData),
    ...base64ToBuffer(tag),
  ]);
  try {
    return new TextDecoder().decode(
      gcm(secret, base64ToBuffer(iv)).decrypt(ciphertext),
    );
  } catch {
    throw new Error("Error decrypting data");
  }
}

// Passkey/WebAuthn utilities

export function isPasskeySupported(): boolean {
  const isSecureContext =
    typeof window !== "undefined" &&
    window.isSecureContext &&
    window.location.protocol === "https:";

  return (
    isSecureContext &&
    typeof navigator !== "undefined" &&
    "credentials" in navigator &&
    "create" in navigator.credentials &&
    "get" in navigator.credentials &&
    typeof PublicKeyCredential !== "undefined"
  );
}

function base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
  if (typeof base64Url !== "string") {
    throw new Error(
      `Invalid credential ID: expected string, got ${typeof base64Url}`,
    );
  }
  // Convert base64url to base64
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding if needed
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export interface PasskeyCredential {
  id: string;
  rawId: ArrayBuffer;
  response: AuthenticatorAttestationResponse;
}

export interface PasskeyAssertion {
  id: string;
  rawId: ArrayBuffer;
  response: AuthenticatorAssertionResponse;
}

export async function createPasskey(
  userId: string,
  userName: string,
): Promise<PasskeyCredential> {
  if (!isPasskeySupported()) {
    throw new Error("Passkeys are not supported in this browser");
  }

  const userIdBuffer = sha256(new TextEncoder().encode(userId)).slice(0, 32);

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions =
    {
      challenge,
      rp: {
        name: "Framezoo",
        id: window.location.hostname,
      },
      user: {
        id: userIdBuffer,
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" }, // ES256
        { alg: -257, type: "public-key" }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "preferred",
      },
      timeout: 60000,
      attestation: "none",
    };

  try {
    const credential = (await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions,
    })) as PublicKeyCredential | null;

    if (!credential) {
      throw new Error("Failed to create passkey");
    }

    return {
      id: credential.id,
      rawId: credential.rawId,
      response: credential.response as AuthenticatorAttestationResponse,
    };
  } catch (error) {
    throw new Error(
      `Failed to create passkey: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function authenticatePasskey(
  credentialId?: string,
): Promise<PasskeyAssertion> {
  if (!isPasskeySupported()) {
    throw new Error("Passkeys are not supported in this browser");
  }

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const allowCredentials: PublicKeyCredentialDescriptor[] | undefined =
    credentialId && typeof credentialId === "string" && credentialId.length > 0
      ? [
          {
            id: base64UrlToArrayBuffer(credentialId),
            type: "public-key",
          },
        ]
      : undefined;

  const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
    challenge,
    timeout: 60000,
    userVerification: "preferred",
    allowCredentials,
    rpId: window.location.hostname,
  };

  try {
    const assertion = (await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions,
    })) as PublicKeyCredential | null;

    if (!assertion) {
      throw new Error("Failed to authenticate with passkey");
    }

    return {
      id: assertion.id,
      rawId: assertion.rawId,
      response: assertion.response as AuthenticatorAssertionResponse,
    };
  } catch (error) {
    throw new Error(
      `Failed to authenticate with passkey: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function seedFromCredentialId(credentialId: string): Promise<Uint8Array> {
  // Hash credential ID the same way we hash mnemonics
  return pbkdf2Async(sha256, credentialId, "mnemonic", {
    c: 2048,
    dkLen: 32,
  });
}

export async function keysFromCredentialId(
  credentialId: string,
): Promise<Keys> {
  const seed = await seedFromCredentialId(credentialId);
  return keysFromSeed(seed);
}

// Storage helpers for credential mappings
const STORAGE_PREFIX = "__MW::passkey::";

function getStorageKey(backendUrl: string, publicKey: string): string {
  return `${STORAGE_PREFIX}${backendUrl}::${publicKey}`;
}

export function storeCredentialMapping(
  backendUrl: string,
  publicKey: string,
  credentialId: string,
): void {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("localStorage is not available");
  }
  const key = getStorageKey(backendUrl, publicKey);
  localStorage.setItem(key, credentialId);
}

export function getCredentialId(
  backendUrl: string,
  publicKey: string,
): string | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  const key = getStorageKey(backendUrl, publicKey);
  return localStorage.getItem(key);
}

export function removeCredentialMapping(
  backendUrl: string,
  publicKey: string,
): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  const key = getStorageKey(backendUrl, publicKey);
  localStorage.removeItem(key);
}
