import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';

function createAdapter() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to initialize Prisma');
  }

  return new PrismaPg({ connectionString });
}

export function createPrismaClient() {
  return new PrismaClient({ adapter: createAdapter() });
}

export { Prisma, PrismaClient };
export type { bookmarks, feedbacks } from '../generated/prisma/client';
