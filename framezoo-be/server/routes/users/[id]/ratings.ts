import { useAuth } from '~/utils/auth';
import { z } from 'zod';

const userRatingsSchema = z.object({
  tmdb_id: z.number(),
  type: z.enum(['movie', 'tv']),
  rating: z.number().min(0).max(10),
});

export default defineEventHandler(async event => {
  const userId = event.context.params?.id;

  const session = await useAuth().getCurrentSession();

  if (session.user !== userId) {
    throw createError({
      statusCode: 403,
      message: 'Permission denied',
    });
  }

  if (event.method === 'GET') {
    const ratings = await prisma.users.findMany({
      select: {
        ratings: true,
      },
      where: {
        id: userId,
      },
    });

    return {
      userId,
      ratings: ratings[0].ratings,
    };
  } else if (event.method === 'POST') {
    const body = await readBody(event);
    const validatedBody = userRatingsSchema.parse(body);

    const user = await prisma.users.findUnique({
      where: {
        id: userId,
      },
      select: {
        ratings: true,
      },
    });

    const userRatings = user?.ratings || [];
    const currentRatings = Array.isArray(userRatings) ? userRatings : [];

    const existingRatingIndex = currentRatings.findIndex(
      (r: any) => r.tmdb_id === validatedBody.tmdb_id && r.type === validatedBody.type
    );

    let updatedRatings;
    if (existingRatingIndex >= 0) {
      updatedRatings = [...currentRatings];
      updatedRatings[existingRatingIndex] = validatedBody;
    } else {
      updatedRatings = [...currentRatings, validatedBody];
    }

    await prisma.users.update({
      where: {
        id: userId,
      },
      data: {
        ratings: updatedRatings,
      },
    });

    return {
      userId,
      rating: {
        tmdb_id: validatedBody.tmdb_id,
        type: validatedBody.type,
        rating: validatedBody.rating,
      },
    };
  }

  // This should only execute if the method is neither GET nor POST
  throw createError({
    statusCode: 405,
    message: 'Method not allowed',
  });
});
