import { defineEventHandler, deleteCookie } from 'h3';
import { ADMIN_COOKIE, revokeAdminSession } from '~/utils/admin';

export default defineEventHandler(async event => {
  try {
    await revokeAdminSession(event);
    return { success: true };
  } finally {
    deleteCookie(event, ADMIN_COOKIE, { path: '/api' });
  }
});
