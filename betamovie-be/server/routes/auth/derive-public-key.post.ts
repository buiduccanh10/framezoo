import { z } from 'zod';
import { pbkdf2 } from 'crypto';
import nacl from 'tweetnacl';

const requestSchema = z.object({
  mnemonic: z.string().min(1),
});

function toBase64Url(input: Uint8Array): string {
  const base64 = Buffer.from(input).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pbkdf2Async(password: string, salt: string, iterations: number, keyLen: number, digest: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, keyLen, digest, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(new Uint8Array(derivedKey));
    });
  });
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
    });
  }

  const { mnemonic } = parsed.data;

  // PBKDF2 (HMAC-SHA256) -> 32-byte seed, iterations = 2048, salt = "mnemonic"
  const seed = await pbkdf2Async(mnemonic, 'mnemonic', 2048, 32, 'sha256');

  // Deterministic Ed25519 keypair from seed
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const publicKeyBase64Url = toBase64Url(keyPair.publicKey);

  return { publicKey: publicKeyBase64Url };
});


// curl -X POST http://localhost:3000/auth/derive-public-key \
//   -H 'Content-Type: application/json' \
//   -d '{"mnemonic":"right inject hazard canoe carry unfair cram physical chief nice real tribute"}'