import { useAuth } from '#imports';
import { prisma } from '#imports';

export default defineEventHandler(async event => {
  const userId = event.context.params?.id;
  const listId = event.context.params?.listId;
  const session = await useAuth().getCurrentSession();

  if (session.user !== userId) {
    throw createError({
      statusCode: 403,
      message: 'Cannot delete lists for other users',
    });
  }
  const list = await prisma.lists.findUnique({
    where: { id: listId },
  });

  if (!list) {
    throw createError({
      statusCode: 404,
      message: 'List not found',
    });
  }

  if (list.user_id !== userId) {
    throw createError({
      statusCode: 403,
      message: "Cannot delete lists you don't own",
    });
  }

  await prisma.$transaction(async tx => {
    await tx.list_items.deleteMany({
      where: { list_id: listId },
    });

    await tx.lists.delete({
      where: { id: listId },
    });
  });

  return {
    id: listId,
    message: 'List deleted successfully',
  };
});
