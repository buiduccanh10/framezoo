export interface FeedbackUser {
  id: string;
  nickname: string;
  email: string | null;
}

export interface FeedbackItem {
  id: string;
  title: string;
  description: string;
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
  bookmarks: number;
  watchHistory: number;
  progress: number;
  sessions: number;
  addons: number;
}

export interface AdminUserItem {
  id: string;
  nickname: string;
  email: string | null;
  created_at: string;
  last_logged_in: string | null;
  permissions: string[];
  profile?: UserProfile;
  counts: UserCounts;
}

export interface UserSessionItem {
  id: string;
  device: string;
  user_agent: string;
  created_at: string;
  accessed_at: string;
  expires_at: string;
}

export interface InstalledAddonManifest {
  id?: string;
  version?: string;
  name?: string;
  description?: string;
  logo?: string;
  resources?: any[];
  types?: string[];
  behaviorHints?: Record<string, any>;
}

export interface UserInstalledAddon {
  manifestUrl: string;
  baseUrl?: string;
  manifest?: InstalledAddonManifest;
  enabled?: boolean;
  addedAt?: number;
  isNative?: boolean;
}

export interface UserSettingsDetail {
  applicationTheme?: string | null;
  applicationLanguage?: string;
  defaultSubtitleLanguage?: string | null;
  enableAutoplay?: boolean;
  enableSkipCredits?: boolean;
  proxyTmdb?: boolean;
  debridService?: string | null;
  febboxKey?: string | null;
  proxyUrls?: string[] | null;
  addons?: UserInstalledAddon[];
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
    public_key?: string;
    namespace?: string;
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
