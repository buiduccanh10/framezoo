export function progressIsNotStarted(duration: number, watched: number): boolean {
  if (watched < 20) return true;
  return false;
}

export function progressIsCompleted(duration: number, watched: number): boolean {
  const timeFromEnd = duration - watched;
  if (timeFromEnd < 60 * 2) return true;
  return false;
}

export async function shouldSaveProgress(
  userId: string,
  tmdbId: string,
  metaType: string,
  duration: number,
  watched: number,
  seasonId?: string | null,
  episodeId?: string | null,
) {
  const isNotStarted = progressIsNotStarted(duration, watched);
  const isCompleted = progressIsCompleted(duration, watched);
  const isAcceptable = !isNotStarted && !isCompleted;

  if (metaType === 'movie') {
    return isAcceptable;
  }

  if (isAcceptable) return true;
  if (!seasonId) return false;

  const seasonEpisodes = await prisma.progress_items.findMany({
    where: {
      user_id: userId,
      tmdb_id: tmdbId,
      season_id: seasonId,
      episode_id: {
        not: episodeId || null,
      },
    },
  });

  return seasonEpisodes.some((episode) => {
    const episodeDuration = Number(episode.duration);
    const episodeWatched = Number(episode.watched);
    return (
      !progressIsNotStarted(episodeDuration, episodeWatched) &&
      !progressIsCompleted(episodeDuration, episodeWatched)
    );
  });
}
