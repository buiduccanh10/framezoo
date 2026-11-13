import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { adminApi } from "../lib/api";
import type {
  AdminUserItem,
  UserDetailData,
  UserPagination,
  UserStats,
} from "../types";

const EMPTY_STATS: UserStats = {
  totalUsers: 0,
  activeRecently: 0,
  usersWithEmail: 0,
  totalSessions: 0,
};
const EMPTY_PAGINATION: UserPagination = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 1,
};

export function useUserManagement(
  api: typeof adminApi,
  showMessage: (message: string) => void,
  onStatsUpdate?: (total: number) => void,
) {
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("created_desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<"overview" | "sessions">(
    "overview",
  );
  const [userToEdit, setUserToEdit] = useState<AdminUserItem | null>(null);
  const [editNickname, setEditNickname] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [userToDelete, setUserToDelete] = useState<AdminUserItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [userToRevoke, setUserToRevoke] = useState<{
    id: string;
    nickname: string;
  } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadUsers = useCallback(
    async (
      targetPage = page,
      targetSearch = search,
      targetSort = sort,
      targetLimit = limit,
    ) => {
      setLoading(true);
      try {
        const data = await api.listUsers(
          targetPage,
          targetSearch,
          targetSort,
          targetLimit,
        );
        setUsers(data.items || []);
        setPagination(
          data.pagination || {
            ...EMPTY_PAGINATION,
            page: targetPage,
            limit: targetLimit,
          },
        );
        if (
          data.pagination?.total > 0 &&
          targetPage > data.pagination.totalPages
        ) {
          setPage(data.pagination.totalPages);
          return;
        }
        setStats(data.stats || EMPTY_STATS);
        onStatsUpdate?.(data.stats?.totalUsers || 0);
      } catch {
        showMessage("Không thể tải danh sách người dùng.");
      } finally {
        setLoading(false);
      }
    },
    [api, limit, onStatsUpdate, page, search, showMessage, sort],
  );

  useEffect(() => {
    const timer = window.setTimeout(
      () => void loadUsers(page, search, sort, limit),
      search ? 220 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [limit, loadUsers, page, search, sort]);

  const openUserDetail = useCallback(
    async (userId: string) => {
      setSelectedUserId(userId);
      setUserDetail(null);
      setDetailLoading(true);
      setDetailTab("overview");
      try {
        setUserDetail(await api.getUser(userId));
      } catch {
        showMessage("Không thể tải chi tiết người dùng.");
      } finally {
        setDetailLoading(false);
      }
    },
    [api, showMessage],
  );

  const openEdit = (user: AdminUserItem) => {
    setUserToEdit(user);
    setEditNickname(user.nickname);
    setEditEmail(user.email || "");
  };
  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!userToEdit) return;
    setEditLoading(true);
    try {
      const user = await api.updateUser(userToEdit.id, {
        nickname: editNickname.trim(),
        email: editEmail.trim() || null,
      });
      showMessage(`Đã cập nhật người dùng ${user.nickname}`);
      setUserToEdit(null);
      await loadUsers(page, search, sort, limit);
      if (selectedUserId === userToEdit.id) await openUserDetail(userToEdit.id);
    } catch {
      showMessage("Không thể cập nhật người dùng");
    } finally {
      setEditLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;
    setDeleteLoading(true);
    try {
      const result = await api.deleteUser(userToDelete.id);
      showMessage(result.message || "Đã xóa người dùng");
      setUserToDelete(null);
      if (selectedUserId === userToDelete.id) {
        setSelectedUserId(null);
        setUserDetail(null);
      }
      await loadUsers(page, search, sort, limit);
    } catch {
      showMessage("Không thể xóa người dùng");
    } finally {
      setDeleteLoading(false);
    }
  };

  const confirmRevokeSessions = async () => {
    if (!userToRevoke) return;
    const { id: userId } = userToRevoke;
    setRevokingId(userId);
    try {
      const result = await api.revokeUserSessions(userId);
      showMessage(result.message || "Đã đăng xuất các thiết bị của người dùng");
      setUserToRevoke(null);
      await loadUsers(page, search, sort, limit);
      if (selectedUserId === userId) await openUserDetail(userId);
    } catch {
      showMessage("Không thể đăng xuất phiên người dùng");
    } finally {
      setRevokingId(null);
    }
  };

  const copyText = async (text: string, label = "User ID") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(text);
      showMessage(`Đã sao chép ${label}`);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      showMessage("Không thể sao chép vào clipboard");
    }
  };

  const closeDetail = () => {
    setSelectedUserId(null);
    setUserDetail(null);
  };
  const setSearchAndReset = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const setSortAndReset = (value: string) => {
    setSort(value);
    setPage(1);
  };
  const setLimitAndReset = (value: number) => {
    setLimit(value);
    setPage(1);
  };

  return {
    users,
    stats,
    pagination,
    loading,
    search,
    sort,
    page,
    limit,
    selectedUserId,
    userDetail,
    detailLoading,
    detailTab,
    userToEdit,
    editNickname,
    editEmail,
    editLoading,
    userToDelete,
    deleteLoading,
    userToRevoke,
    revokingId,
    copiedId,
    setSearch: setSearchAndReset,
    setSort: setSortAndReset,
    setPage,
    setLimit: setLimitAndReset,
    setDetailTab,
    setEditNickname,
    setEditEmail,
    setUserToEdit,
    setUserToDelete,
    setUserToRevoke,
    loadUsers,
    openUserDetail,
    closeDetail,
    openEdit,
    saveEdit,
    confirmDelete,
    confirmRevokeSessions,
    copyText,
  };
}
