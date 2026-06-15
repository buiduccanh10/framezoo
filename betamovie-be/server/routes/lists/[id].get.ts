import { prisma } from '#imports';

export default defineEventHandler(async event => {
  const id = event.context.params?.id;
  const listInfo = await prisma.lists.findUnique({
    where: {
      id: id,
    },
    include: {
      list_items: true,
    },
  });

  if (!listInfo.public) {
    return createError({
      statusCode: 403,
      message: 'List is not public',
    });
  }

  return listInfo;
});
