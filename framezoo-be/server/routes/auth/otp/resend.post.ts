import { z } from 'zod';
import { resendOtpChallenge, type OtpPurpose } from '~/utils/emailOtp';
import { sendEmail } from '~/utils/email';
import { throwOtpHttpError } from '~/utils/otpHttp';

const schema = z.object({
  challengeId: z.string().uuid(),
});

type EmailTemplate = Parameters<typeof sendEmail>[0]['template'];

const templateForPurpose = (purpose: OtpPurpose): EmailTemplate => {
  switch (purpose) {
    case 'registration':
      return 'registration-otp' as const;
    case 'password_reset':
      return 'password-reset-otp' as const;
    case 'password_change':
      return 'password-change-otp' as const;
    case 'email_change_old':
      return 'email-change-old-otp' as const;
    case 'email_change_new':
      return 'email-change-new-otp' as const;
  }
};

export default defineEventHandler(async event => {
  const result = schema.safeParse(await readBody(event));
  if (!result.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body' });
  }

  try {
    return await resendOtpChallenge({
      challengeId: result.data.challengeId,
      event,
      send: (purpose, email, code) =>
        sendEmail({ to: email, template: templateForPurpose(purpose), code }),
    });
  } catch (error) {
    throwOtpHttpError(error);
  }
});
