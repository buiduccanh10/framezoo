import { z } from 'zod';
import { useChallenge } from '~/utils/challenge';

const startSchema = z.object({
  nickname: z.string().min(1).max(255),
});

export default defineEventHandler(async event => {
  const body = await readBody(event);

  const result = startSchema.safeParse(body);
  if (!result.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
    });
  }

  // Check if user exists with this nickname
  const user = await prisma.users.findUnique({
    where: { nickname: body.nickname },
  });

  if (!user) {
    throw createError({
      statusCode: 401,
      message: 'User cannot be found',
    });
  }

  const challenge = useChallenge();
  const challengeCode = await challenge.createChallengeCode('login', 'mnemonic');

  return {
    challenge: challengeCode.code,
    publicKey: user.public_key,
  };
});
