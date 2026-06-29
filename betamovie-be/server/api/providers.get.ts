import { getProviderMetadata } from '~/providers/metadata';

export default defineEventHandler(event => {
  setHeader(event, 'cache-control', 'no-store');

  return {
    providers: getProviderMetadata(),
  };
});
