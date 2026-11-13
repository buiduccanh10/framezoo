export interface FeedbackUser {
  id: string;
  nickname: string;
}

export interface FeedbackItem {
  id: string;
  title: string;
  description: string;
  contact: string | null;
  status: "pending" | "resolved" | string;
  user_id: string | null;
  user: FeedbackUser | null;
  attachments: FeedbackAttachment[];
  created_at: string;
  updated_at: string;
}

export interface FeedbackAttachment {
  key: string;
  name: string;
  type: string;
  kind: "image" | "video";
  size: number;
  url: string;
}

export interface UserProfile {
  icon?: string;
  colorA?: string;
  colorB?: string;
}

export interface UserCounts {
  sessions: number;
}

export interface AdminUserItem {
  id: string;
  nickname: string;
  email: string | null;
  created_at: string;
  last_logged_in: string | null;
  permissions: string[];
  profile?: UserProfile;
  app_version: string | null;
  counts: UserCounts;
}

export interface UserSessionItem {
  id: string;
  device: string;
  platform: string;
  app_version: string | null;
  created_at: string;
  accessed_at: string;
  expires_at: string;
}

export interface UserSettingsDetail {
  applicationTheme?: string | null;
  applicationLanguage?: string;
  defaultSubtitleLanguage?: string | null;
  enableAutoplay?: boolean;
  enableSkipCredits?: boolean;
}

export interface UserDetailData {
  user: {
    id: string;
    nickname: string;
    email: string | null;
    created_at: string;
    last_logged_in: string | null;
    permissions: string[];
    profile?: UserProfile;
    namespace?: string;
    app_version: string | null;
  };
  settings: UserSettingsDetail | null;
  sessions: UserSessionItem[];
  counts: UserCounts;
}

export interface UserStats {
  totalUsers: number;
  activeRecently: number;
  usersWithEmail: number;
  totalSessions: number;
}

export interface UserPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
