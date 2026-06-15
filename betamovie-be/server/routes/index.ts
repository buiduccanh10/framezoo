import { version } from '~/utils/config';
export default defineEventHandler(event => {
  return {
    message: `Backend is working as expected (v${version})`,
  };
});
