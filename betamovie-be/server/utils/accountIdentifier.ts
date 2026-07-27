export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function findUserByAccountIdentifier(
  identifier: string,
  publicKey?: string,
) {
  const normalizedIdentifier = identifier.trim();

  return prisma.users.findFirst({
    where: {
      OR: [
        { nickname: normalizedIdentifier },
        {
          email: {
            equals: normalizeEmail(normalizedIdentifier),
            mode: 'insensitive',
          },
        },
        ...(publicKey ? [{ public_key: publicKey }] : []),
      ],
    },
  });
}
