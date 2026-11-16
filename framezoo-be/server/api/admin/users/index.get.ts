import { defineEventHandler, getQuery } from 'h3';
import { prisma, Prisma } from '~/utils/prisma';
import { getSemverOrderBySql, requireAdmin } from '~/utils/admin';
import { decryptPiiOrNull, hashEmailIndex } from '~/utils/piiCrypto';

interface AdminUserRow {
  id: string;
  nickname: string;
  email: string | null;
  created_at: Date;
  last_active: Date | null;
  permissions: string[];
  profile: Prisma.JsonValue;
  effective_app_version: string | null;
  active_sessions: number;
  is_suspended: boolean;
  suspended_at: Date | null;
  suspended_reason: string | null;
  terms_version: string | null;
  privacy_version: string | null;
  consented_at: Date | null;
  age_confirmed: boolean;
}

interface AdminStatsRow {
  total_users: number;
  active_recently: number;
  users_with_email: number;
}

const getOrderBySql = (sort: string): Prisma.Sql => {
  switch (sort) {
    case 'created_asc':
      return Prisma.sql`ORDER BY created_at ASC`;
    case 'login_desc':
      return Prisma.sql`ORDER BY last_active DESC NULLS LAST, created_at DESC`;
    case 'login_asc':
      return Prisma.sql`ORDER BY last_active ASC NULLS LAST, created_at ASC`;
    case 'nickname_asc':
      return Prisma.sql`ORDER BY LOWER(nickname) ASC, created_at DESC`;
    case 'nickname_desc':
      return Prisma.sql`ORDER BY LOWER(nickname) DESC, created_at DESC`;
    case 'version_desc':
      return getSemverOrderBySql('effective_app_version', 'DESC', Prisma.sql`created_at DESC`);
    case 'version_asc':
      return getSemverOrderBySql('effective_app_version', 'ASC', Prisma.sql`created_at DESC`);
    case 'created_desc':
    default:
      return Prisma.sql`ORDER BY created_at DESC`;
  }
};

export default defineEventHandler(async event => {
  await requireAdmin(event);

  const query = getQuery(event);
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit || '10'), 10) || 10));
  const sort = typeof query.sort === 'string' ? query.sort : 'created_desc';

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const offset = (page - 1) * limit;
  const searchEmailHash = search ? hashEmailIndex(search) : '';

  const userViewCte = Prisma.sql`
    WITH session_agg AS (
      SELECT
        "user" AS user_id,
        MAX(accessed_at) AS max_accessed_at,
        COUNT(*) FILTER (WHERE expires_at > ${now})::int AS active_sessions,
        (ARRAY_AGG(app_version ORDER BY accessed_at DESC NULLS LAST)
          FILTER (WHERE app_version IS NOT NULL AND app_version <> ''))[1] AS latest_session_version
      FROM sessions
      GROUP BY "user"
    ),
    user_view AS (
      SELECT
        u.id,
        u.nickname,
        u.email,
        u.email_hash,
        u.created_at,
        u.permissions,
        u.profile,
        u.is_suspended,
        u.suspended_at,
        u.suspended_reason,
        u.terms_version,
        u.privacy_version,
        u.consented_at,
        u.age_confirmed,
        COALESCE(sa.latest_session_version, NULLIF(u.app_version, '')) AS effective_app_version,
        CASE
          WHEN u.last_logged_in IS NULL THEN sa.max_accessed_at
          WHEN sa.max_accessed_at IS NULL THEN u.last_logged_in
          ELSE GREATEST(u.last_logged_in, sa.max_accessed_at)
        END AS last_active,
        COALESCE(sa.active_sessions, 0)::int AS active_sessions
      FROM users u
      LEFT JOIN session_agg sa ON sa.user_id = u.id
    )
  `;

  const whereClause = search
    ? Prisma.sql`WHERE strpos(lower(nickname), lower(${search})) > 0 OR strpos(lower(id), lower(${search})) > 0 OR email_hash = ${searchEmailHash}`
    : Prisma.empty;
  const orderByClause = getOrderBySql(sort);

  const [statsRows, totalSessions, countRows, users] = await Promise.all([
    prisma.$queryRaw<AdminStatsRow[]>`
      ${userViewCte}
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE last_active >= ${thirtyDaysAgo})::int AS active_recently,
        COUNT(*) FILTER (WHERE email IS NOT NULL)::int AS users_with_email
      FROM user_view
    `,
    prisma.sessions.count({ where: { expires_at: { gt: now } } }),
    search
      ? prisma.$queryRaw<{ total: number }[]>`
          ${userViewCte}
          SELECT COUNT(*)::int AS total
          FROM user_view
          ${whereClause}
        `
      : Promise.resolve(null),
    prisma.$queryRaw<AdminUserRow[]>`
      ${userViewCte}
      SELECT
        id,
        nickname,
        email,
        created_at,
        last_active,
        permissions,
        profile,
        is_suspended,
        suspended_at,
        suspended_reason,
        terms_version,
        privacy_version,
        consented_at,
        age_confirmed,
        effective_app_version,
        active_sessions
      FROM user_view
      ${whereClause}
      ${orderByClause}
      LIMIT ${limit}
      OFFSET ${offset}
    `,
  ]);

  const statsRow = statsRows[0] ?? { total_users: 0, active_recently: 0, users_with_email: 0 };
  const totalCount = countRows ? (countRows[0]?.total ?? 0) : statsRow.total_users;

  const items = users.map(u => ({
    id: u.id,
    nickname: u.nickname,
    email: decryptPiiOrNull(u.email),
    created_at: u.created_at,
    last_logged_in: u.last_active,
    permissions: u.permissions,
    profile: u.profile,
    is_suspended: u.is_suspended,
    suspended_at: u.suspended_at,
    suspended_reason: u.suspended_reason,
    terms_version: u.terms_version,
    privacy_version: u.privacy_version,
    consented_at: u.consented_at,
    age_confirmed: u.age_confirmed,
    app_version: u.effective_app_version || null,
    counts: {
      sessions: u.active_sessions,
    },
  }));

  return {
    items,
    pagination: {
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit) || 1,
    },
    stats: {
      totalUsers: statsRow.total_users,
      activeRecently: statsRow.active_recently,
      usersWithEmail: statsRow.users_with_email,
      totalSessions,
    },
  };
});
