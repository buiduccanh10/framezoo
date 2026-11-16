import { fallbackCuratedLists } from '~/utils/discover-enrichment';
import { tmdb } from '~/utils/tmdb';

export default defineCachedEventHandler(
  async () => {
    const curated = await fallbackCuratedLists();
    const lists = await Promise.all(
      curated.map(async entry => {
        const movieResults = await Promise.all(
          entry.tmdbIds.slice(0, 20).map(async id => {
            try {
              const details = (await tmdb.movies.details(id)) as any;
              if (!details?.id) return null;
              return {
                adult: Boolean(details.adult),
                backdrop_path: details.backdrop_path ?? null,
                genre_ids: Array.isArray(details.genres)
                  ? details.genres.map((g: any) => Number(g.id)).filter(Number.isFinite)
                  : [],
                id: details.id,
                original_language: details.original_language ?? 'en',
                original_title: details.original_title ?? details.title ?? '',
                overview: details.overview ?? '',
                popularity: Number(details.popularity) || 0,
                poster_path: details.poster_path ?? null,
                release_date: details.release_date ?? '',
                title: details.title ?? '',
                video: Boolean(details.video),
                vote_average: Number(details.vote_average) || 0,
                vote_count: Number(details.vote_count) || 0,
              };
            } catch {
              return null;
            }
          })
        );

        const tmdbMovies = movieResults.filter((m): m is NonNullable<typeof m> => m !== null);

        return {
          listName: entry.listName,
          listUrl: '',
          tmdbMovies,
          metadata: {
            originalFilmCount: entry.count,
            foundTmdbMovies: tmdbMovies.length,
            expectedItemCount: entry.count,
            workingSelector: 'tmdb-api',
          },
        };
      })
    );

    const totalTmdbMovies = lists.reduce((sum, list) => sum + list.tmdbMovies.length, 0);
    return {
      lists,
      totalLists: lists.length,
      summary: {
        totalTmdbMovies,
        totalExpectedItems: totalTmdbMovies,
      },
    };
  },
  {
    maxAge: process.env.NODE_ENV === 'production' ? 60 * 60 * 24 : 0,
  }
);
