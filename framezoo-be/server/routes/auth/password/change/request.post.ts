import { prisma } from '~/utils/prisma';
import { useAuth } from '~/utils/auth';
import { createOtpChallenge } from '~/utils/emailOtp';
import { throwOtpHttpError } from '~/utils/otpHttp';

export default defineEventHandler(async event => {
  const auth = useAuth();
  const session = await auth.getCurrentSessionForEvent(event);
  if (!session) throw createError({ statusCode: 401, message: 'Unauthorized' });

  const user = await prisma.users.findUnique({ where: { id: session.user } });
  if (!user?.email) throw createError({ statusCode: 400, message: 'Account has no email address' });
  const email = user.email;

  try {
    return await createOtpChallenge({
      purpose: 'password_change',
      email,
      userId: user.id,
      event,
      template: 'password-change-otp',
    });
  } catch (error) {
    throwOtpHttpError(error, event);
  }
});
