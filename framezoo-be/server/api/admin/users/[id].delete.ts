import { defineEventHandler, createError } from 'h3';
import { requireAdmin } from '~/utils/admin';
import { deleteUserAccountData } from '~/utils/accountDeletion';

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const userId = event.context.params?.id;
  if (!userId) {
    throw createError({
      statusCode: 400,
      message: 'User ID is required',
    });
  }

  const deletedUser = await deleteUserAccountData(userId);

  return {
    success: true,
    message: `User ${deletedUser.nickname} (${userId}) deleted successfully`,
  };
});
