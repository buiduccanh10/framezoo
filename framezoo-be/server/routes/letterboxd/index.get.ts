import * as cheerio from 'cheerio';
import { TMDB } from 'tmdb-ts';

export default defineCachedEventHandler(async (event) => {
  try {
    const runtimeConfig = useRuntimeConfig(event);
    const tmdbKey =
      ((runtimeConfig.tmdbApiKey as string | undefined) || process.env.TMDB_API_KEY || '').trim();
    if (!tmdbKey) {
      return {
        lists: [],
        error: 'TMDB API key is not configured',
      };
    }
    const tmdb = new TMDB(tmdbKey);

    const response = await fetch('https://letterboxd.com/lists/');
    let html = await response.text();
    
    html = html.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    
    const $ = cheerio.load(html);
    
    const listItems = $('a.list-link').map((i, el) => ({
      href: $(el).attr('href'),
      title: $(el).find('.list-name').text().trim() || $(el).attr('title'),
      text: $(el).text().trim()
    })).get();
    
    if (!listItems.length) {
      return { 
        lists: [],
        error: 'No lists found'
      };
    }

    const allLists = [];

    for (let i = 0; i < listItems.length; i++) {
      const listItem = listItems[i];
      
      if (!listItem.href) {
        continue;
      }

      try {
        const listUrl = `https://letterboxd.com${listItem.href}`;
        const listResponse = await fetch(listUrl);
        let listHtml = await listResponse.text();
        
        listHtml = listHtml.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        
        const list$ = cheerio.load(listHtml);
        
        const ogTitle = list$('meta[property="og:title"]').attr('content');
        const listName = ogTitle || listItem.title;
        
        const listStatsText = list$('.list-meta .stats').text();
        const itemCountMatch = listStatsText.match(/(\d+)\s*film/i);
        const expectedItemCount = itemCountMatch ? parseInt(itemCountMatch[1]) : null;
        
        const possibleFilmSelectors = [
          'li.poster-container',
          '.poster-container', 
          '.film-poster',
          '.poster',
          'li[data-film-slug]',
          '[data-film-slug]',
          '.listitem',
          '.list-item'
        ];
        
        let films = [];
        let workingSelector = '';
        
        for (const selector of possibleFilmSelectors) {
          const elements = list$(selector);
          
          if (elements.length > 0) {
            workingSelector = selector;
            films = elements.map((i, el) => {
              const filmSlug = list$(el).attr('data-film-slug');
              const targetLink = list$(el).attr('data-target-link');
              const filmId = list$(el).attr('data-film-id');
              
              const filmName = filmSlug 
                ? filmSlug.split('-').map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1)
                  ).join(' ')
                : targetLink?.split('/film/')[1]?.split('/')[0]?.replace(/-/g, ' ');
              
              return {
                name: filmName,
                slug: filmSlug,
                link: targetLink,
                filmId: filmId
              };
            }).get().filter(film => film.name);
            
            if (films.length > 0) {
              break;
            }
          }
        }

        const tmdbMovies = [];
        
        for (let j = 0; j < films.length; j++) {
          const film = films[j];
          
          try {
            const searchResult = await tmdb.search.movies({ query: film.name });
            
            if (searchResult.results && searchResult.results.length > 0) {
              const tmdbMovie = searchResult.results[0];
              tmdbMovies.push(tmdbMovie);
            }
          } catch (error) {
            continue;
          }
        }
        
        allLists.push({
          listName: listName,
          listUrl: listUrl,
          tmdbMovies,
          metadata: {
            originalFilmCount: films.length,
            foundTmdbMovies: tmdbMovies.length,
            expectedItemCount: expectedItemCount,
            workingSelector
          }
        });

      } catch (error) {
        allLists.push({
          listName: listItem.title,
          listUrl: `https://letterboxd.com${listItem.href}`,
          tmdbMovies: [],
          metadata: {
            originalFilmCount: 0,
            foundTmdbMovies: 0,
            expectedItemCount: null,
            error: 'Failed to process list'
          }
        });
      }
    }
    
    return { 
      lists: allLists,
      totalLists: allLists.length,
      summary: {
        totalTmdbMovies: allLists.reduce((sum, list) => sum + list.tmdbMovies.length, 0),
        totalExpectedItems: allLists.reduce((sum, list) => sum + (list.metadata?.expectedItemCount || 0), 0)
      }
    };
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch Letterboxd lists'
    });
  }
},{
    maxAge: process.env.NODE_ENV === 'production' ? 60 * 60 * 24 : 0
});
