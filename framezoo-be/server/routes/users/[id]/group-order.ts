import { randomUUID } from 'crypto';
import { useAuth } from '~/utils/auth';
import { z } from 'zod';

const groupOrderSchema = z.array(z.string());

export default defineEventHandler(async event => {
  const userId = event.context.params?.id;
  const method = event.method;

  const session = await useAuth().getCurrentSession();

  if (session.user !== userId) {
    throw createError({
      statusCode: 403,
      message: 'Cannot access other user information',
    });
  }

  if (method === 'GET') {
    const groupOrder = await prisma.user_group_order.findUnique({
      where: { user_id: userId },
    });

    return {
      groupOrder: groupOrder?.group_order || [],
    };
  }

  if (method === 'PUT') {
    const body = await readBody(event);
    const validatedGroupOrder = groupOrderSchema.parse(body);

    const groupOrder = await prisma.user_group_order.upsert({
      where: { user_id: userId },
      update: {
        group_order: validatedGroupOrder,
        updated_at: new Date(),
      },
      create: {
        id: randomUUID(),
        user_id: userId,
        group_order: validatedGroupOrder,
      },
    });

    return {
      groupOrder: groupOrder.group_order,
    };
  }

  throw createError({
    statusCode: 405,
    message: 'Method not allowed',
  });
}); 