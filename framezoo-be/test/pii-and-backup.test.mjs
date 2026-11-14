import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

process.env.CRYPTO_SECRET = 'pii-backup-test-secret';

const {
  decryptPii,
  decryptPiiOrNull,
  encryptPii,
  hashContactIndex,
  hashEmailIndex,
  isEncryptedPii,
} = await import('../server/utils/piiCrypto.ts');

const { decryptBackupBuffer, encryptBackupBuffer } = await import(
  '../server/utils/backupCrypto.ts'
);

test('PII AES-256-GCM encryption uses random IVs, authenticates ciphertext, and supports legacy plaintext fallback', () => {
  const email = 'User.Example+test@FrameZoo.Top';
  const encryptedA = encryptPii(email);
  const encryptedB = encryptPii(email);

  assert.notEqual(encryptedA, email);
  assert.notEqual(encryptedA, encryptedB);
  assert.equal(isEncryptedPii(encryptedA), true);
  assert.equal(decryptPii(encryptedA), email);
  assert.equal(decryptPii(encryptedB), email);

  const parts = encryptedA.split('.');
  const mutatedTag = `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3].slice(0, -2)}AA`;
  assert.throws(() => decryptPii(mutatedTag));

  // Legacy plaintext rows remain readable until backfilled.
  assert.equal(isEncryptedPii('legacy@example.com'), false);
  assert.equal(decryptPii('legacy@example.com'), 'legacy@example.com');
  assert.equal(decryptPiiOrNull(null), null);
  assert.equal(decryptPiiOrNull(''), null);
});

test('blind indexes normalize email and phone contacts deterministically', () => {
  assert.equal(
    hashEmailIndex('  Admin@Example.COM '),
    hashEmailIndex('admin@example.com'),
  );
  assert.notEqual(
    hashEmailIndex('admin@example.com'),
    hashEmailIndex('other@example.com'),
  );
  assert.equal(
    hashContactIndex(' +84 (912) 345-678 '),
    hashContactIndex('+84912345678'),
  );
});

test('backup archive cipher encrypts with FZBK1 header, rejects tampering, and rejects wrong keys', () => {
  const rawArchive = Buffer.from('\x1f\x8b\x08\x00framezoo-sql-dump-payload', 'binary');
  const encryptedA = encryptBackupBuffer(rawArchive);
  const encryptedB = encryptBackupBuffer(rawArchive);

  assert.equal(encryptedA.subarray(0, 5).toString('ascii'), 'FZBK1');
  assert.notEqual(encryptedA.compare(encryptedB), 0);
  assert.deepEqual(decryptBackupBuffer(encryptedA), rawArchive);
  assert.deepEqual(decryptBackupBuffer(encryptedB), rawArchive);

  const tampered = Buffer.from(encryptedA);
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => decryptBackupBuffer(tampered));

  const previousKey = process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = 'different-backup-key';
  try {
    assert.throws(() => decryptBackupBuffer(encryptedA));
  } finally {
    if (previousKey === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previousKey;
  }
});

test('backup pipeline uploads encrypted archives and accepts both .tar.gz.enc and legacy formats on restore', () => {
  const backupUtil = fs.readFileSync(
    new URL('../server/utils/backup.ts', import.meta.url),
    'utf8',
  );
  const importRoute = fs.readFileSync(
    new URL('../server/api/backup/import.post.ts', import.meta.url),
    'utf8',
  );

  assert.match(backupUtil, /encryptBackupBuffer\(fs\.readFileSync\(archivePath\)\)/);
  assert.match(backupUtil, /backups\/\$\{archiveFile\}\.enc/);
  assert.match(backupUtil, /decryptBackupBuffer\(buffer\)/);
  assert.match(importRoute, /\.endsWith\('\.tar\.gz\.enc'\)/);
  assert.match(importRoute, /\.endsWith\('\.tar\.gz'\)/);
  assert.match(importRoute, /\.endsWith\('\.sql'\)/);
});
