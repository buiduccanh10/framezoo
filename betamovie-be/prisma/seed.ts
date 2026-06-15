import { PrismaClient } from '@prisma/client';
import { pbkdf2Sync } from 'crypto';
import nacl from 'tweetnacl';

const prisma = new PrismaClient();

function toBase64Url(input: Uint8Array): string {
  const base64 = Buffer.from(input).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function main() {
  const adminId = '00000000-0000-0000-0000-000000000001';
  const passphrase = 'buiduccanh27102002';

  // PBKDF2 (HMAC-SHA256) -> 32-byte seed, iterations = 2048, salt = "mnemonic"
  const seed = pbkdf2Sync(passphrase, 'mnemonic', 2048, 32, 'sha256');

  // Deterministic Ed25519 keypair from seed
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(seed));
  const publicKeyBase64Url = toBase64Url(keyPair.publicKey);

  await prisma.users.upsert({
    where: { id: adminId },
    update: {
      public_key: publicKeyBase64Url,
      permissions: ['admin'],
    },
    create: {
      id: adminId,
      namespace: 'movie-web',
      public_key: publicKeyBase64Url,
      nickname: 'Admin',
      created_at: new Date(),
      last_logged_in: new Date(),
      permissions: ['admin'],
      profile: {
        colorA: '#7b2ff7',
        colorB: '#21d4fd',
        icon: 'cat',
      },
    } as any,
  });

  await prisma.user_settings.upsert({
    where: { id: adminId },
    update: {
      application_theme: 'ember',
    },
    create: {
      id: adminId,
      application_theme: 'ember',
      proxy_urls: [],
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
