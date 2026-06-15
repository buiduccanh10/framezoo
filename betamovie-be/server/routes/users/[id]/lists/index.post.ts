import { useAuth } from '#imports';
import { prisma } from '~/utils/prisma';
import { z } from 'zod';

const listItemSchema = z.object({
  tmdb_id: z.string(),
  type: z.enum(['movie', 'tv']),
});

const createListSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(255).optional().nullable(),
  items: z.array(listItemSchema).optional(),
  public: z.boolean().optional(),
});

export default defineEventHandler(async event => {
  const userId = event.context.params?.id;
  const session = await useAuth().getCurrentSession();

  if (session.user !== userId) {
    throw createError({
      statusCode: 403,
      message: 'Cannot modify user other than yourself',
    });
  }

  const body = await readBody(event);

  let parsedBody;
  try {
    parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
  } catch (error) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body format',
    });
  }

  const validatedBody = createListSchema.parse(parsedBody);

  const result = await prisma.$transaction(async tx => {
    const newList = await tx.lists.create({
      data: {
        user_id: userId,
        name: validatedBody.name,
        description: validatedBody.description || null,
        public: validatedBody.public || false,
      },
    });

    if (validatedBody.items && validatedBody.items.length > 0) {
      await tx.list_items.createMany({
        data: validatedBody.items.map(item => ({
          list_id: newList.id,
          tmdb_id: item.tmdb_id,
          type: item.type, // Type is mapped here
        })),
        skipDuplicates: true,
      });
    }

    return tx.lists.findUnique({
      where: { id: newList.id },
      include: { list_items: true },
    });
  });

  return {
    list: result,
    message: 'List created successfully',
  };
});
