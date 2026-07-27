import { z } from 'zod';
import { useChallenge } from '~/utils/challenge';
import { findUserByAccountIdentifier } from '~/utils/accountIdentifier';

const startSchema = z.object({
  identifier: z.string().min(1).max(255).optional(),
  nickname: z.string().min(1).max(255).optional(),
}).refine((value) => value.identifier || value.nickname, {
  message: 'Account identifier is required',
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

  const identifier = body.identifier ?? body.nickname;
  const user = await findUserByAccountIdentifier(identifier, identifier);

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
