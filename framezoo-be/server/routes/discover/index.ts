export default defineCachedEventHandler(
  async () => {
    const popular = {
      movies: (await (tmdb as any).movies.popular({})).results.sort(
        (a, b) => b.vote_average - a.vote_average
      ),
      shows: (await (tmdb as any).tvShows.popular({})).results.sort(
        (a, b) => b.vote_average - a.vote_average
      ),
    };

    const topRatedMovies = (await (tmdb as any).movies.topRated({})).results.sort(
      (a, b) => b.vote_average - a.vote_average
    );
    const topRatedShows = (await (tmdb as any).tvShows.topRated({})).results.sort(
      (a, b) => b.vote_average - a.vote_average
    );

    const genres = {
      movies: await (tmdb as any).genres.movies({}),
      shows: await (tmdb as any).genres.tvShows({}),
    };
    const topRated = {
      movies: topRatedMovies,
      shows: topRatedShows,
    };
    const nowPlaying = {
      movies: (await (tmdb as any).movies.nowPlaying({})).results.sort(
        (a, b) => b.vote_average - a.vote_average
      ),
      shows: (await (tmdb as any).tvShows.onTheAir({})).results.sort(
        (a, b) => b.vote_average - a.vote_average
      ),
    };

    const top10 = {
      movies: topRatedMovies.slice(0, 10),
      shows: topRatedShows.slice(0, 10),
    };

    const latesttv = {
      shows: nowPlaying.shows,
    };

    return {
      popular,
      topRated,
      nowPlaying,
      genres,
      top10,
      latesttv,
    };
  },

  {
    maxAge: process.env.NODE_ENV === 'production' ? 60 * 60 : 0, // 20 Minutes for prod, no cache for dev. Customize to your liking
  }
);
