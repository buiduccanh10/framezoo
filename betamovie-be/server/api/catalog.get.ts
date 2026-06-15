export default defineEventHandler(async event => {
  const storage = useStorage('cache');
  const catalog = await storage.getItem('tmdb:catalog');

  if (!catalog) {
    return {
      status: 'error',
      message: 'Catalog not yet available. Crawler might be running.',
      updatedAt: null,
    };
  }

  return catalog;
});
