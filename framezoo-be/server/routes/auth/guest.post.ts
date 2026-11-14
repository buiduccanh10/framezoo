import { issueGuestTokenForEvent } from '~/utils/guestTracking';

export default defineEventHandler(event => issueGuestTokenForEvent(event));
