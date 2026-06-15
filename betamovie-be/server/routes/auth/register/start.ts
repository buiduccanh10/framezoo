import { z } from 'zod';
import { useChallenge } from '~/utils/challenge';

const startSchema = z.object({
  captchaToken: z.string().optional(),
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

  const challenge = useChallenge();
  const challengeCode = await challenge.createChallengeCode('registration', 'mnemonic');

  return {
    challenge: challengeCode.code,
  };
});
