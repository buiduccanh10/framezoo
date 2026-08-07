import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

const defaultDatabaseUrl = 'postgresql://prisma:prisma@127.0.0.1:5432/prisma?schema=public';

config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
});

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL || defaultDatabaseUrl,
  },
});
