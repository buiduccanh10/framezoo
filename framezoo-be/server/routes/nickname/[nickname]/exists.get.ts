export default defineEventHandler(async event => {
  const nickname = event.context.params?.nickname;

  if (!nickname) {
    throw createError({
      statusCode: 400,
      message: 'Nickname is required',
    });
  }

  const user = await prisma.users.findUnique({
    where: { nickname: nickname },
    select: { id: true },
  });

  return {
    exists: !!user,
  };
});
