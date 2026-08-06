export default defineEventHandler(async event => {
  const userId = event.context.params?.id;

  if (!userId) {
    throw createError({
      statusCode: 400,
      message: 'User ID is required',
    });
  }

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  return {
    exists: !!user,
  };
});
