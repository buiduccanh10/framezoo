import { pbkdf2Sync } from 'crypto';
import { existsSync } from 'fs';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import nacl from 'tweetnacl';
import { createPrismaClient } from './client';

for (const envUrl of [new URL('../.env', import.meta.url), new URL('../../.env', import.meta.url)]) {
  const envPath = fileURLToPath(envUrl);
  if (existsSync(envPath)) {
    config({ path: envPath });
  }
}

const prisma = createPrismaClient();
const DEFAULT_ADMIN_NICKNAME = 'Admin';
const DEFAULT_ADMIN_NAMESPACE = 'movie-web';
const DEFAULT_ADMIN_PROFILE = {
  colorA: '#7b2ff7',
  colorB: '#21d4fd',
  icon: 'cat',
};

function toBase64Url(input: Uint8Array): string {
  const base64 = Buffer.from(input).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getSeedConfig() {
  const adminId = process.env.SEED_ADMIN_ID?.trim();
  const passphrase = process.env.SEED_ADMIN_PASSPHRASE?.trim();
  const adminNickname = process.env.SEED_ADMIN_NICKNAME?.trim() || null;
  const adminNamespace = process.env.SEED_ADMIN_NAMESPACE?.trim() || null;

  if (!adminId) {
    throw new Error('SEED_ADMIN_ID is required');
  }

  if (!passphrase) {
    throw new Error('SEED_ADMIN_PASSPHRASE is required');
  }

  return { adminId, passphrase, adminNickname, adminNamespace };
}

async function main() {
  const { adminId, passphrase, adminNickname, adminNamespace } = getSeedConfig();

  // PBKDF2 (HMAC-SHA256) -> 32-byte seed, iterations = 2048, salt = "mnemonic"
  const seed = pbkdf2Sync(passphrase, 'mnemonic', 2048, 32, 'sha256');

  // Deterministic Ed25519 keypair from seed
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(seed));
  const publicKeyBase64Url = toBase64Url(keyPair.publicKey);
  const now = new Date();

  await prisma.$transaction(async tx => {
    const [adminUsers, userById, userByNickname] = await Promise.all([
      tx.users.findMany({
        where: {
          permissions: {
            has: 'admin',
          },
        },
        orderBy: { created_at: 'asc' },
        take: 2,
      }),
      tx.users.findUnique({ where: { id: adminId } }),
      adminNickname ? tx.users.findUnique({ where: { nickname: adminNickname } }) : null,
    ]);

    if (adminUsers.length > 1) {
      throw new Error(
        `Seed account conflict: expected exactly 1 admin account, found ${adminUsers.length}.`
      );
    }

    const existingAdmin = adminUsers[0] ?? null;

    if (existingAdmin && userById && userById.id !== existingAdmin.id) {
      throw new Error(
        `Seed account conflict: target id "${adminId}" already belongs to non-admin user "${userById.nickname}".`
      );
    }

    if (existingAdmin && userByNickname && userByNickname.id !== existingAdmin.id) {
      throw new Error(
        `Seed account conflict: nickname "${adminNickname}" already belongs to non-admin user "${userByNickname.id}".`
      );
    }

    if (!existingAdmin && userById && userByNickname && userById.id !== userByNickname.id) {
      throw new Error(
        `Seed account conflict: id "${adminId}" and nickname "${adminNickname}" resolve to different users.`
      );
    }

    const currentAdmin = existingAdmin ?? userById ?? userByNickname;

    if (!currentAdmin) {
      await tx.users.create({
        data: {
          id: adminId,
          namespace: adminNamespace || DEFAULT_ADMIN_NAMESPACE,
          public_key: publicKeyBase64Url,
          nickname: adminNickname || DEFAULT_ADMIN_NICKNAME,
          created_at: now,
          last_logged_in: now,
          permissions: ['admin'],
          profile: DEFAULT_ADMIN_PROFILE,
        } as any,
      });
    } else {
      const previousId = currentAdmin.id;

      if (previousId !== adminId) {
        await tx.$executeRaw`UPDATE "bookmarks" SET "user_id" = ${adminId} WHERE "user_id" = ${previousId}`;
        await tx.$executeRaw`UPDATE "lists" SET "user_id" = ${adminId} WHERE "user_id" = ${previousId}`;
        await tx.$executeRaw`UPDATE "progress_items" SET "user_id" = ${adminId} WHERE "user_id" = ${previousId}`;
        await tx.$executeRaw`UPDATE "sessions" SET "user" = ${adminId} WHERE "user" = ${previousId}`;
        await tx.$executeRaw`UPDATE "watch_history" SET "user_id" = ${adminId} WHERE "user_id" = ${previousId}`;
        await tx.$executeRaw`UPDATE "users" SET "invited_by" = ${adminId} WHERE "invited_by" = ${previousId}`;
        await tx.$executeRaw`UPDATE "user_settings" SET "id" = ${adminId} WHERE "id" = ${previousId}`;
        await tx.$executeRaw`UPDATE "user_group_order" SET "user_id" = ${adminId} WHERE "user_id" = ${previousId}`;
      }

      await tx.users.update({
        where: { id: previousId },
        data: {
          id: adminId,
          namespace: adminNamespace || currentAdmin.namespace || DEFAULT_ADMIN_NAMESPACE,
          public_key: publicKeyBase64Url,
          nickname: adminNickname || currentAdmin.nickname || DEFAULT_ADMIN_NICKNAME,
          last_logged_in: now,
          permissions: ['admin'],
          profile: (currentAdmin as any).profile || DEFAULT_ADMIN_PROFILE,
        } as any,
      });
    }

    await tx.user_settings.upsert({
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
  });

  console.log(`Seeded admin account (${adminId})`);
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
