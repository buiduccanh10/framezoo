import { handleVixsrcProxy } from '~/utils/vixsrcProxy';

// Universal route keeps the explicit HEAD handling reachable in Nitro.
export default defineEventHandler(handleVixsrcProxy);
