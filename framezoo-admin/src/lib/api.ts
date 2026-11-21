import axios, { AxiosError } from "axios";
import type {
  AdminUserItem,
  FeedbackItem,
  GuestListResponse,
  GuestPlatformFilter,
  GuestWindow,
  TakedownRuleItem,
  TakedownTargetType,
  UserDetailData,
  UserPagination,
  UserStats,
  ListPagination,
} from "../types";

const API_BASE = "/api";

export interface BackupStatus {
  totalBackups: number;
  backupSize: string;
  totalSizeBytes: number;
  backupExists: boolean;
  latestBackup?: string;
}

export interface BackupFile {
  name: string;
  size: string;
  sizeBytes: number;
  created: string;
  path: string;
}

interface LoginResponse {
  success: boolean;
}

interface UserListResponse {
  items: AdminUserItem[];
  pagination: UserPagination;
  stats: UserStats;
}

interface FeedbackStatsSummary {
  total: number;
  pending: number;
  resolved: number;
  pendingCopyright?: number;
  pendingPrivacy?: number;
  overdueCompliance?: number;
}

interface FeedbackListResponse {
  success: boolean;
  feedbacks: FeedbackItem[];
  pagination: ListPagination;
  stats: FeedbackStatsSummary;
}

export interface FeedbackList {
  items: FeedbackItem[];
  pagination: ListPagination;
  stats: FeedbackStatsSummary;
}

export interface BackupFileList {
  files: BackupFile[];
  pagination: ListPagination;
}

export const adminHttp = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    Accept: "application/json",
    "X-Admin-Request": "1",
  },
});

let onUnauthorized: (() => void) | undefined;

export function setUnauthorizedHandler(handler: (() => void) | undefined) {
  onUnauthorized = handler;
}

adminHttp.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

export function getApiError(error: unknown, fallback: string) {
  if (error instanceof AxiosError) {
    const message = error.response?.data;
    if (message && typeof message === "object" && "message" in message) {
      return String(message.message);
    }
    if (!error.response) {
      return "Không thể kết nối đến máy chủ.";
    }
    if (error.response.status >= 500) {
      return `Lỗi máy chủ (${error.response.status}).`;
    }
  }
  return fallback;
}

export const adminApi = {
  async login(username: string, password: string) {
    const { data } = await adminHttp.post<LoginResponse>("/backup/login", {
      username,
      password,
    });
    return data;
  },

  async logout() {
    await adminHttp.post("/backup/logout");
  },

  async getBackupStatus() {
    const { data } = await adminHttp.get<BackupStatus>("/backup/status");
    return data;
  },

  async getBackupFiles(page = 1, limit = 10) {
    const { data } = await adminHttp.get<BackupFileList>("/backup/files", {
      params: { page, limit },
    });
    return {
      files: data.files || [],
      pagination: data.pagination || { page, limit, total: 0, totalPages: 1 },
    };
  },

  async triggerBackup() {
    const { data } = await adminHttp.post<{ message?: string }>(
      "/backup/manual",
    );
    return data;
  },

  async deleteBackup(filename: string) {
    const { data } = await adminHttp.delete<{ message?: string }>(
      `/backup/delete/${encodeURIComponent(filename)}`,
    );
    return data;
  },

  async deleteAllBackups() {
    const { data } = await adminHttp.delete<{ message?: string }>(
      "/backup/delete-all",
    );
    return data;
  },

  async restoreBackup(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const { data } = await adminHttp.post<{ message?: string }>(
      "/backup/import",
      formData,
    );
    return data;
  },

  async downloadBackup(filename: string) {
    const { data } = await adminHttp.get<Blob>(
      `/backup/download/${encodeURIComponent(filename)}`,
      { responseType: "blob" },
    );
    return data;
  },

  async listFeedback(
    page = 1,
    limit = 10,
    search = "",
    status: "all" | "pending" | "resolved" = "all",
    category = "all",
  ) {
    const { data } = await adminHttp.get<FeedbackListResponse>("/feedback", {
      params: {
        page,
        limit,
        search: search || undefined,
        status: status === "all" ? undefined : status,
        category: category === "all" ? undefined : category,
      },
    });
    return {
      items: data.feedbacks || [],
      pagination: data.pagination || { page, limit, total: 0, totalPages: 1 },
      stats: data.stats || { total: 0, pending: 0, resolved: 0 },
    } satisfies FeedbackList;
  },

  async updateFeedback(id: string, status: "pending" | "resolved") {
    const { data } = await adminHttp.patch<{ feedback: FeedbackItem }>(
      `/feedback/${encodeURIComponent(id)}`,
      { status },
    );
    return data.feedback;
  },

  async deleteFeedback(id: string) {
    await adminHttp.delete(`/feedback/${encodeURIComponent(id)}`);
  },

  async listUsers(page = 1, search = "", sort = "login_desc", limit = 10) {
    const { data } = await adminHttp.get<UserListResponse>("/admin/users", {
      params: { page, limit, search: search || undefined, sort },
    });
    return data;
  },

  async getUser(id: string) {
    const { data } = await adminHttp.get<UserDetailData>(
      `/admin/users/${encodeURIComponent(id)}`,
    );
    return data;
  },

  async updateUser(
    id: string,
    input: {
      nickname?: string;
      email?: string | null;
      isSuspended?: boolean;
      suspendedReason?: string | null;
    },
  ) {
    const { data } = await adminHttp.patch<{ user: AdminUserItem }>(
      `/admin/users/${encodeURIComponent(id)}`,
      input,
    );
    return data.user;
  },

  async listTakedowns(params?: {
    targetType?: string;
    active?: "all" | "true" | "false";
    search?: string;
  }) {
    const { data } = await adminHttp.get<{
      success: boolean;
      rules: TakedownRuleItem[];
      stats: { total: number; active: number };
    }>("/admin/takedowns", {
      params: {
        targetType:
          params?.targetType && params.targetType !== "all"
            ? params.targetType
            : undefined,
        active:
          params?.active && params.active !== "all" ? params.active : undefined,
        search: params?.search || undefined,
      },
    });
    return data;
  },

  async createTakedown(input: {
    targetType: TakedownTargetType;
    pattern: string;
    reason: string;
    rightsHolder?: string | null;
    referenceId?: string | null;
    active?: boolean;
  }) {
    const { data } = await adminHttp.post<{
      success: boolean;
      rule: TakedownRuleItem;
    }>("/admin/takedowns", input);
    return data.rule;
  },

  async updateTakedown(
    id: string,
    input: {
      active?: boolean;
      reason?: string;
      rightsHolder?: string | null;
      referenceId?: string | null;
    },
  ) {
    const { data } = await adminHttp.patch<{
      success: boolean;
      rule: TakedownRuleItem;
    }>(`/admin/takedowns/${encodeURIComponent(id)}`, input);
    return data.rule;
  },

  async deleteTakedown(id: string) {
    await adminHttp.delete(`/admin/takedowns/${encodeURIComponent(id)}`);
  },

  async deleteUser(id: string) {
    const { data } = await adminHttp.delete<{ message?: string }>(
      `/admin/users/${encodeURIComponent(id)}`,
    );
    return data;
  },

  async revokeUserSessions(id: string) {
    const { data } = await adminHttp.post<{ message?: string }>(
      `/admin/users/${encodeURIComponent(id)}/revoke-sessions`,
    );
    return data;
  },

  async listGuests(params?: {
    page?: number;
    limit?: number;
    window?: GuestWindow;
    search?: string;
    sort?: string;
    platform?: GuestPlatformFilter;
  }) {
    const { data } = await adminHttp.get<GuestListResponse>("/admin/guests", {
      params: {
        page: params?.page ?? 1,
        limit: params?.limit ?? 10,
        window: params?.window ?? "24h",
        search: params?.search || undefined,
        sort: params?.sort || "last_seen_desc",
        platform:
          params?.platform && params.platform !== "all"
            ? params.platform
            : undefined,
      },
    });
    return data;
  },
};
