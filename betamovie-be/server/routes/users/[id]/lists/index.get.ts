import { useAuth } from '#imports';
import { prisma } from '#imports';

export default defineEventHandler(async event => {
  const userId = event.context.params?.id;
  const session = await useAuth().getCurrentSession();

  if (session.user !== userId) {
    throw createError({
      statusCode: 403,
      message: 'Cannot access other user information',
    });
  }

  const lists = await prisma.lists.findMany({
    where: {
      user_id: userId,
    },
    include: {
      list_items: true,
    },
  });

  return {
    lists,
  };
});
