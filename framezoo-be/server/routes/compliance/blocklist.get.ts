import { setHeader } from 'h3';

import { getActiveTakedownBlocklist } from '~/utils/takedown';

export default defineEventHandler(async event => {
  const blocklist = await getActiveTakedownBlocklist();
  setHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return blocklist;
});
