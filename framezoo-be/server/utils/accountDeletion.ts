import { createError } from 'h3';
import { prisma } from '~/utils/prisma';
import { decryptPiiOrNull, hashEmailIndex } from '~/utils/piiCrypto';

export const deleteUserAccountData = async (userId: string): Promise<{ nickname: string }> =>
  prisma.$transaction(async tx => {
    const user = await tx.users.findUnique({
      where: { id: userId },
      select: { nickname: true, email: true, email_hash: true },
    });
    if (!user) {
      throw createError({ statusCode: 404, message: 'User not found' });
    }

    const plainEmail = decryptPiiOrNull(user.email);
    const emailHash = user.email_hash ?? (plainEmail ? hashEmailIndex(plainEmail) : null);
    const otpWhere = {
      OR: [{ user_id: userId }, ...(emailHash ? [{ email_hash: emailHash }] : [])],
    };
    const challenges = await tx.email_otp_challenges.findMany({
      where: otpWhere,
      select: { id: true },
    });
    if (challenges.length) {
      await tx.email_outbox.deleteMany({
        where: { challenge_id: { in: challenges.map(challenge => challenge.id) } },
      });
    }
    await tx.email_otp_challenges.deleteMany({ where: otpWhere });
    if (emailHash || plainEmail) {
      await tx.otp_idempotency_keys.deleteMany({
        where: {
          OR: [
            ...(emailHash ? [{ scope: { contains: `:${emailHash}:` } }] : []),
            ...(plainEmail ? [{ scope: { contains: `:${plainEmail}:` } }] : []),
          ],
        },
      });
    }

    await tx.bookmarks.deleteMany({ where: { user_id: userId } });
    await tx.progress_items.deleteMany({ where: { user_id: userId } });
    await tx.watch_history.deleteMany({ where: { user_id: userId } });
    await tx.user_group_order.deleteMany({ where: { user_id: userId } });
    await tx.user_settings.deleteMany({ where: { id: userId } });
    await tx.user_provider_credentials.deleteMany({ where: { user_id: userId } });
    await tx.sessions.deleteMany({ where: { user: userId } });

    // Reports can contain evidence needed for support or copyright claims.
    // Remove the account link; users can request report deletion separately.
    await tx.feedbacks.updateMany({
      where: { user_id: userId },
      data: { user_id: null },
    });

    await tx.users.delete({ where: { id: userId } });

    return { nickname: user.nickname };
  });
