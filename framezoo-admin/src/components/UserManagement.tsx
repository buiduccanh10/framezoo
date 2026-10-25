import React, { useState, useEffect } from "react";
import type { AxiosInstance } from "axios";
import {
  Users,
  Search,
  RotateCcw,
  Eye,
  Edit2,
  Trash2,
  LogOut,
  X,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
  Bookmark,
  Film,
  Puzzle,
  Smartphone,
  Mail,
  Clock,
  ChevronLeft,
  ChevronRight,
  Sliders,
} from "lucide-react";
import type {
  AdminUserItem,
  UserDetailData,
  UserStats,
  UserPagination,
  UserInstalledAddon,
  UserSessionItem,
} from "../types";

interface UserManagementProps {
  api: AxiosInstance;
  showMessage: (msg: string) => void;
  onStatsUpdate?: (total: number) => void;
}

export function UserManagement({
  api,
  showMessage,
  onStatsUpdate,
}: UserManagementProps) {
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [stats, setStats] = useState<UserStats>({
    totalUsers: 0,
    activeRecently: 0,
    usersWithEmail: 0,
    totalSessions: 0,
  });
  const [pagination, setPagination] = useState<UserPagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 1,
  });

  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("created_desc");
  const [page, setPage] = useState(1);

  // User detail modal
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<
    "overview" | "addons" | "sessions"
  >("overview");

  // Edit modal
  const [userToEdit, setUserToEdit] = useState<AdminUserItem | null>(null);
  const [editNickname, setEditNickname] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // Delete modal
  const [userToDelete, setUserToDelete] = useState<AdminUserItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Revoke loading
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Copy ID feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadUsers = async (
    targetPage = page,
    targetSearch = search,
    targetSort = sort,
  ) => {
    setLoading(true);
    try {
      const res = await api.get("/admin/users", {
        params: {
          page: targetPage,
          search: targetSearch || undefined,
          sort: targetSort,
        },
      });
      if (res.data) {
        setUsers(res.data.items || []);
        if (res.data.pagination) {
          setPagination(res.data.pagination);
        }
        if (res.data.stats) {
          setStats(res.data.stats);
          onStatsUpdate?.(res.data.stats.totalUsers);
        }
      }
    } catch (err: any) {
      console.error(err);
      showMessage("Không thể tải danh sách người dùng.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadUsers(page, search, sort);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, sort]);

  const loadUserDetail = async (userId: string) => {
    setSelectedUserId(userId);
    setDetailLoading(true);
    setDetailTab("overview");
    try {
      const res = await api.get(`/admin/users/${userId}`);
      if (res.data) {
        setUserDetail(res.data);
      }
    } catch (err: any) {
      console.error(err);
      showMessage("Không thể tải chi tiết người dùng.");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleOpenEdit = (user: AdminUserItem) => {
    setUserToEdit(user);
    setEditNickname(user.nickname);
    setEditEmail(user.email || "");
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToEdit) return;
    setEditLoading(true);
    try {
      const res = await api.patch(`/admin/users/${userToEdit.id}`, {
        nickname: editNickname.trim(),
        email: editEmail.trim() || null,
      });
      if (res.data?.user) {
        showMessage(`Đã cập nhật người dùng ${res.data.user.nickname}`);
        setUserToEdit(null);
        loadUsers();
        if (selectedUserId === userToEdit.id) {
          loadUserDetail(userToEdit.id);
        }
      }
    } catch (err: any) {
      alert(err.response?.data?.message || "Không thể cập nhật người dùng");
    } finally {
      setEditLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    setDeleteLoading(true);
    try {
      const res = await api.delete(`/admin/users/${userToDelete.id}`);
      showMessage(res.data?.message || "Đã xóa người dùng");
      setUserToDelete(null);
      if (selectedUserId === userToDelete.id) {
        setSelectedUserId(null);
        setUserDetail(null);
      }
      loadUsers();
    } catch (err: any) {
      alert(err.response?.data?.message || "Không thể xóa người dùng");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRevokeSessions = async (userId: string, userName: string) => {
    if (
      !window.confirm(
        `Đăng xuất toàn bộ các thiết bị của người dùng "${userName}"?`,
      )
    )
      return;
    setRevokingId(userId);
    try {
      const res = await api.post(`/admin/users/${userId}/revoke-sessions`);
      showMessage(
        res.data?.message || "Đã đăng xuất các thiết bị của người dùng",
      );
      loadUsers();
      if (selectedUserId === userId) {
        loadUserDetail(userId);
      }
    } catch (err: any) {
      alert(
        err.response?.data?.message || "Không thể đăng xuất phiên người dùng",
      );
    } finally {
      setRevokingId(null);
    }
  };

  const copyText = (text: string, label = "User ID") => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    showMessage(`Đã sao chép ${label}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "Chưa từng online";
    const d = new Date(dateStr);
    return d.toLocaleString("vi-VN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getRelativeTimeBadge = (dateStr: string | null) => {
    if (!dateStr) {
      return (
        <span className="text-gray-500 text-xs italic">Chưa đăng nhập</span>
      );
    }
    const diffHours =
      (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
    if (diffHours < 24) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          Hôm nay
        </span>
      );
    }
    if (diffHours < 24 * 7) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20">
          {Math.floor(diffHours / 24)} ngày trước
        </span>
      );
    }
    return (
      <span className="text-xs text-gray-400">
        {new Date(dateStr).toLocaleDateString("vi-VN")}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-400">
              Tổng người dùng
            </span>
            <Users size={20} className="text-blue-400" />
          </div>
          <p className="mt-2 text-3xl font-bold font-mono text-white">
            {stats.totalUsers}
          </p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-emerald-300">
              Online gần đây (30d)
            </span>
            <Clock size={20} className="text-emerald-400" />
          </div>
          <p className="mt-2 text-3xl font-bold font-mono text-emerald-400">
            {stats.activeRecently}
          </p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-purple-300">
              Có liên kết Email
            </span>
            <Mail size={20} className="text-purple-400" />
          </div>
          <p className="mt-2 text-3xl font-bold font-mono text-purple-400">
            {stats.usersWithEmail}
          </p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-amber-300">
              Phiên đăng nhập
            </span>
            <Smartphone size={20} className="text-amber-400" />
          </div>
          <p className="mt-2 text-3xl font-bold font-mono text-amber-400">
            {stats.totalSessions}
          </p>
        </div>
      </div>

      {/* Controls: Search, Sort, Refresh */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-96">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Tìm theo nickname, email, user ID..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full bg-black/30 border border-white/10 rounded-xl pl-10 pr-10 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          <div className="flex items-center gap-2 bg-black/30 px-3 py-1.5 rounded-xl border border-white/10 text-xs">
            <span className="text-gray-400">Sắp xếp:</span>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
              className="bg-transparent text-white focus:outline-none cursor-pointer"
            >
              <option value="created_desc" className="bg-gray-900 text-white">
                Mới nhất
              </option>
              <option value="login_desc" className="bg-gray-900 text-white">
                Đăng nhập gần nhất
              </option>
              <option value="nickname_asc" className="bg-gray-900 text-white">
                Tên A-Z
              </option>
              <option value="created_asc" className="bg-gray-900 text-white">
                Cũ nhất
              </option>
            </select>
          </div>

          <button
            onClick={() => loadUsers(page, search, sort)}
            disabled={loading}
            className="px-3 py-2 text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-300 hover:text-white transition-colors flex items-center gap-1.5"
            title="Làm mới danh sách"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin text-blue-400" />
            ) : (
              <RotateCcw size={16} />
            )}
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm min-h-[450px]">
        {loading && users.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Loader2 size={32} className="animate-spin mb-4 text-blue-500" />
            Đang tải danh sách người dùng...
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500 border border-dashed border-white/10 rounded-xl bg-black/20">
            <Users size={48} className="mb-4 opacity-50" />
            <p className="font-medium">
              {search
                ? "Không tìm thấy người dùng phù hợp"
                : "Chưa có người dùng nào"}
            </p>
            {search && (
              <p className="text-xs text-gray-500 mt-1">
                Thử thay đổi từ khóa tìm kiếm
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {users.map((user) => {
              const colorA = user.profile?.colorA || "#3b82f6";
              const colorB = user.profile?.colorB || "#6366f1";
              const isRevoking = revokingId === user.id;

              return (
                <div
                  key={user.id}
                  className="flex flex-col xl:flex-row xl:items-center justify-between p-4 rounded-xl bg-black/30 border border-white/5 hover:border-white/20 transition-all gap-4 group"
                >
                  {/* Left: User Avatar & Basic Info */}
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base shadow-md shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${colorA}, ${colorB})`,
                      }}
                    >
                      {user.nickname
                        ? user.nickname.charAt(0).toUpperCase()
                        : "U"}
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white text-base truncate max-w-[200px] sm:max-w-[260px]">
                          {user.nickname}
                        </span>

                        {user.email ? (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-400 bg-white/5 px-2 py-0.5 rounded-md border border-white/5">
                            <Mail size={12} className="text-purple-400" />
                            <span className="truncate max-w-[180px]">
                              {user.email}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500 italic">
                            Chưa có email
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="font-mono text-[11px] text-gray-400 truncate max-w-[160px] sm:max-w-[220px]">
                          {user.id}
                        </span>
                        <button
                          onClick={() => copyText(user.id, "User ID")}
                          className="hover:text-blue-400 transition-colors p-0.5"
                          title="Sao chép User ID"
                        >
                          {copiedId === user.id ? (
                            <Check size={12} className="text-emerald-400" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Middle: Dates & Counts */}
                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400 xl:justify-center">
                    {/* Activity status & Dates */}
                    <div className="space-y-1 min-w-[140px]">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-500">Online:</span>
                        {getRelativeTimeBadge(user.last_logged_in)}
                      </div>
                      <div className="text-gray-500 text-[11px]">
                        Tham gia:{" "}
                        {new Date(user.created_at).toLocaleDateString("vi-VN")}
                      </div>
                    </div>

                    {/* Counts Chips */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/5 text-gray-300"
                        title="Bookmarks đã lưu"
                      >
                        <Bookmark size={13} className="text-blue-400" />
                        <span className="font-semibold text-white">
                          {user.counts.bookmarks}
                        </span>
                      </span>

                      <span
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/5 text-gray-300"
                        title="Lịch sử xem phim"
                      >
                        <Film size={13} className="text-emerald-400" />
                        <span className="font-semibold text-white">
                          {user.counts.watchHistory}
                        </span>
                      </span>

                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-gray-300 ${
                          user.counts.addons > 0
                            ? "bg-purple-500/10 border-purple-500/30 text-purple-300"
                            : "bg-white/5 border-white/5"
                        }`}
                        title="Addons đã cài đặt"
                      >
                        <Puzzle size={13} className="text-purple-400" />
                        <span className="font-semibold text-white">
                          {user.counts.addons}
                        </span>
                        <span className="text-[10px]">addons</span>
                      </span>

                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-gray-300 ${
                          user.counts.sessions > 0
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                            : "bg-white/5 border-white/5"
                        }`}
                        title="Phiên đăng nhập đang hoạt động"
                      >
                        <Smartphone size={13} className="text-amber-400" />
                        <span className="font-semibold text-white">
                          {user.counts.sessions}
                        </span>
                        <span className="text-[10px]">thiết bị</span>
                      </span>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end xl:self-center">
                    <button
                      onClick={() => loadUserDetail(user.id)}
                      className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors text-xs font-medium flex items-center gap-1.5 border border-white/10"
                      title="Xem chi tiết người dùng"
                    >
                      <Eye size={14} className="text-blue-400" />
                      <span>Chi tiết</span>
                    </button>

                    <button
                      onClick={() => handleOpenEdit(user)}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors border border-white/10"
                      title="Chỉnh sửa thông tin"
                    >
                      <Edit2 size={14} />
                    </button>

                    {user.counts.sessions > 0 && (
                      <button
                        onClick={() =>
                          handleRevokeSessions(user.id, user.nickname)
                        }
                        disabled={isRevoking}
                        className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors border border-amber-500/20"
                        title="Đăng xuất tất cả thiết bị"
                      >
                        {isRevoking ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <LogOut size={14} />
                        )}
                      </button>
                    )}

                    <button
                      onClick={() => setUserToDelete(user)}
                      className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors border border-red-500/20"
                      title="Xóa người dùng"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Controls */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between pt-6 border-t border-white/10 mt-6 text-xs text-gray-400">
            <div>
              Hiển thị trang <span className="text-white">{pagination.page}</span> /{" "}
              <span>{pagination.totalPages}</span> ({pagination.total} người
              dùng)
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 transition-colors flex items-center gap-1"
              >
                <ChevronLeft size={14} /> Trước
              </button>
              <button
                onClick={() =>
                  setPage((p) => Math.min(pagination.totalPages, p + 1))
                }
                disabled={page >= pagination.totalPages || loading}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 transition-colors flex items-center gap-1"
              >
                Sau <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* User Detail Modal */}
      {selectedUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in">
          <div className="bg-[#141419] border border-white/10 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                {userDetail ? (
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg"
                    style={{
                      background: `linear-gradient(135deg, ${
                        userDetail.user.profile?.colorA || "#3b82f6"
                      }, ${userDetail.user.profile?.colorB || "#6366f1"})`,
                    }}
                  >
                    {userDetail.user.nickname.charAt(0).toUpperCase()}
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center">
                    <Users size={22} className="text-white" />
                  </div>
                )}
                <div>
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    {userDetail ? userDetail.user.nickname : "Đang tải..."}
                  </h3>
                  <p className="text-xs text-gray-400">
                    {userDetail?.user.email || "Chưa liên kết email"}
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setSelectedUserId(null);
                  setUserDetail(null);
                }}
                className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {detailLoading || !userDetail ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <Loader2
                    size={36}
                    className="animate-spin text-blue-500 mb-3"
                  />
                  Đang tải thông tin chi tiết người dùng...
                </div>
              ) : (
                <>
                  {/* Account Summary Chips */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div className="p-3 bg-white/5 rounded-xl border border-white/5 text-center">
                      <div className="text-xs text-gray-400 flex items-center justify-center gap-1 mb-1">
                        <Bookmark size={12} className="text-blue-400" />
                        <span>Bookmarks</span>
                      </div>
                      <div className="text-lg font-bold text-white font-mono">
                        {userDetail.counts.bookmarks}
                      </div>
                    </div>

                    <div className="p-3 bg-white/5 rounded-xl border border-white/5 text-center">
                      <div className="text-xs text-gray-400 flex items-center justify-center gap-1 mb-1">
                        <Film size={12} className="text-emerald-400" />
                        <span>Đã xem</span>
                      </div>
                      <div className="text-lg font-bold text-white font-mono">
                        {userDetail.counts.watchHistory}
                      </div>
                    </div>

                    <div className="p-3 bg-white/5 rounded-xl border border-white/5 text-center">
                      <div className="text-xs text-gray-400 flex items-center justify-center gap-1 mb-1">
                        <Clock size={12} className="text-amber-400" />
                        <span>Tiến độ</span>
                      </div>
                      <div className="text-lg font-bold text-white font-mono">
                        {userDetail.counts.progress}
                      </div>
                    </div>

                    <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20 text-center">
                      <div className="text-xs text-purple-300 flex items-center justify-center gap-1 mb-1">
                        <Puzzle size={12} className="text-purple-400" />
                        <span>Addons</span>
                      </div>
                      <div className="text-lg font-bold text-white font-mono">
                        {userDetail.counts.addons}
                      </div>
                    </div>

                    <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-center">
                      <div className="text-xs text-amber-300 flex items-center justify-center gap-1 mb-1">
                        <Smartphone size={12} className="text-amber-400" />
                        <span>Thiết bị</span>
                      </div>
                      <div className="text-lg font-bold text-white font-mono">
                        {userDetail.counts.sessions}
                      </div>
                    </div>
                  </div>

                  {/* Sub-tabs inside modal */}
                  <div className="flex border-b border-white/10 text-sm font-medium gap-6">
                    <button
                      onClick={() => setDetailTab("overview")}
                      className={`pb-3 border-b-2 transition-all flex items-center gap-2 ${
                        detailTab === "overview"
                          ? "border-blue-500 text-blue-400 font-semibold"
                          : "border-transparent text-gray-400 hover:text-white"
                      }`}
                    >
                      <Sliders size={15} />
                      <span>Cài đặt & Tài khoản</span>
                    </button>

                    <button
                      onClick={() => setDetailTab("addons")}
                      className={`pb-3 border-b-2 transition-all flex items-center gap-2 ${
                        detailTab === "addons"
                          ? "border-blue-500 text-blue-400 font-semibold"
                          : "border-transparent text-gray-400 hover:text-white"
                      }`}
                    >
                      <Puzzle size={15} />
                      <span>Addons ({userDetail.counts.addons})</span>
                    </button>

                    <button
                      onClick={() => setDetailTab("sessions")}
                      className={`pb-3 border-b-2 transition-all flex items-center gap-2 ${
                        detailTab === "sessions"
                          ? "border-blue-500 text-blue-400 font-semibold"
                          : "border-transparent text-gray-400 hover:text-white"
                      }`}
                    >
                      <Smartphone size={15} />
                      <span>Phiên hoạt động ({userDetail.counts.sessions})</span>
                    </button>
                  </div>

                  {/* TAB 1: OVERVIEW & SETTINGS */}
                  {detailTab === "overview" && (
                    <div className="space-y-4">
                      {/* Identity Details */}
                      <div className="p-4 bg-black/40 rounded-xl border border-white/5 space-y-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                          Thông tin tài khoản
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div>
                            <span className="text-gray-500">User ID:</span>
                            <div className="font-mono text-gray-200 mt-0.5 flex items-center gap-1.5 break-all">
                              <span>{userDetail.user.id}</span>
                              <button
                                onClick={() =>
                                  copyText(userDetail.user.id, "User ID")
                                }
                                className="text-gray-400 hover:text-white"
                              >
                                <Copy size={12} />
                              </button>
                            </div>
                          </div>

                          <div>
                            <span className="text-gray-500">Namespace:</span>
                            <div className="text-gray-200 mt-0.5">
                              {userDetail.user.namespace || "movie-web"}
                            </div>
                          </div>

                          <div>
                            <span className="text-gray-500">Ngày tạo:</span>
                            <div className="text-gray-200 mt-0.5">
                              {formatDateTime(userDetail.user.created_at)}
                            </div>
                          </div>

                          <div>
                            <span className="text-gray-500">
                              Đăng nhập cuối:
                            </span>
                            <div className="text-gray-200 mt-0.5">
                              {formatDateTime(userDetail.user.last_logged_in)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Video Player & Preferences */}
                      <div className="p-4 bg-black/40 rounded-xl border border-white/5 space-y-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                          Tùy chọn & Cấu hình thiết bị
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          <div>
                            <span className="text-gray-500">Giao diện (Theme):</span>
                            <div className="text-gray-200 font-medium capitalize mt-0.5">
                              {userDetail.settings?.applicationTheme || "ember (mặc định)"}
                            </div>
                          </div>

                          <div>
                            <span className="text-gray-500">Ngôn ngữ app:</span>
                            <div className="text-gray-200 font-medium mt-0.5 uppercase">
                              {userDetail.settings?.applicationLanguage || "en"}
                            </div>
                          </div>

                          <div>
                            <span className="text-gray-500">Phụ đề mặc định:</span>
                            <div className="text-gray-200 font-medium mt-0.5">
                              {userDetail.settings?.defaultSubtitleLanguage || "Không chọn"}
                            </div>
                          </div>

                          <div>
                            <span className="text-gray-500">Tự động phát:</span>
                            <div className="text-gray-200 font-medium mt-0.5">
                              {userDetail.settings?.enableAutoplay ? "Bật" : "Tắt"}
                            </div>
                          </div>

                          <div>
                            <span className="text-gray-500">Bỏ qua credits:</span>
                            <div className="text-gray-200 font-medium mt-0.5">
                              {userDetail.settings?.enableSkipCredits ? "Bật" : "Tắt"}
                            </div>
                          </div>

                          <div>
                            <span className="text-gray-500">Dịch vụ Debrid:</span>
                            <div className="text-gray-200 font-medium mt-0.5">
                              {userDetail.settings?.debridService || "Chưa cấu hình"}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: INSTALLED ADDONS */}
                  {detailTab === "addons" && (
                    <div className="space-y-3">
                      {!userDetail.settings?.addons ||
                      userDetail.settings.addons.length === 0 ? (
                        <div className="text-center py-12 border border-dashed border-white/10 rounded-xl bg-black/20 text-gray-500">
                          <Puzzle size={40} className="mx-auto mb-3 opacity-40" />
                          <p className="font-medium text-sm">
                            Người dùng chưa cài đặt addon nào
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            Addons khi cài trên web, desktop hoặc mobile sẽ tự động đồng bộ tại đây.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {userDetail.settings.addons.map(
                            (addon: UserInstalledAddon, idx: number) => {
                              const manifest = addon.manifest || {};
                              const resources = Array.isArray(manifest.resources)
                                ? manifest.resources.map((r: any) =>
                                    typeof r === "string" ? r : r.name || "",
                                  )
                                : [];

                              return (
                                <div
                                  key={idx}
                                  className="flex items-start justify-between p-3.5 rounded-xl bg-black/40 border border-white/5 gap-3"
                                >
                                  <div className="flex items-start gap-3 min-w-0">
                                    {manifest.logo ? (
                                      <img
                                        src={manifest.logo}
                                        alt={manifest.name || "Addon"}
                                        className="w-10 h-10 rounded-lg object-contain bg-black/40 p-1 shrink-0 border border-white/10"
                                        onError={(e) => {
                                          (e.target as HTMLElement).style.display = "none";
                                        }}
                                      />
                                    ) : (
                                      <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0 text-purple-400">
                                        <Puzzle size={18} />
                                      </div>
                                    )}

                                    <div className="min-w-0 space-y-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <h5 className="font-semibold text-white text-sm truncate">
                                          {manifest.name || "Addon không tên"}
                                        </h5>
                                        {manifest.version && (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 border border-white/10 text-gray-400">
                                            v{manifest.version}
                                          </span>
                                        )}
                                        {addon.enabled !== false ? (
                                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                            Đang bật
                                          </span>
                                        ) : (
                                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-500/10 text-gray-400 border border-gray-500/20">
                                            Đã tắt
                                          </span>
                                        )}
                                      </div>

                                      {manifest.description && (
                                        <p className="text-xs text-gray-400 line-clamp-1">
                                          {manifest.description}
                                        </p>
                                      )}

                                      <div className="flex items-center gap-2 text-xs text-gray-500 font-mono text-[11px] truncate">
                                        <span className="truncate max-w-sm">
                                          {addon.manifestUrl}
                                        </span>
                                        <button
                                          onClick={() =>
                                            copyText(addon.manifestUrl, "Manifest URL")
                                          }
                                          className="text-gray-400 hover:text-white"
                                          title="Sao chép URL"
                                        >
                                          <Copy size={11} />
                                        </button>
                                      </div>

                                      {resources.length > 0 && (
                                        <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                                          {resources.map((resName, rIdx) => (
                                            <span
                                              key={rIdx}
                                              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20"
                                            >
                                              {resName}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            },
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 3: SESSIONS */}
                  {detailTab === "sessions" && (
                    <div className="space-y-4">
                      {userDetail.sessions.length > 0 && (
                        <div className="flex items-center justify-between pb-2">
                          <span className="text-xs text-gray-400">
                            Có {userDetail.sessions.length} thiết bị đang đăng nhập
                          </span>
                          <button
                            onClick={() =>
                              handleRevokeSessions(
                                userDetail.user.id,
                                userDetail.user.nickname,
                              )
                            }
                            disabled={revokingId === userDetail.user.id}
                            className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-medium flex items-center gap-1.5 transition-colors"
                          >
                            <LogOut size={13} />
                            <span>Đăng xuất tất cả thiết bị</span>
                          </button>
                        </div>
                      )}

                      {userDetail.sessions.length === 0 ? (
                        <div className="text-center py-12 border border-dashed border-white/10 rounded-xl bg-black/20 text-gray-500">
                          <Smartphone
                            size={40}
                            className="mx-auto mb-3 opacity-40"
                          />
                          <p className="font-medium text-sm">
                            Không có phiên đăng nhập nào đang hoạt động
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {userDetail.sessions.map((session: UserSessionItem) => (
                            <div
                              key={session.id}
                              className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Smartphone
                                    size={15}
                                    className="text-amber-400"
                                  />
                                  <span className="font-semibold text-white text-sm">
                                    {session.device || "Framezoo Client"}
                                  </span>
                                </div>
                                <span className="text-[11px] text-gray-500">
                                  Hết hạn:{" "}
                                  {new Date(session.expires_at).toLocaleDateString(
                                    "vi-VN",
                                  )}
                                </span>
                              </div>

                              <p className="text-xs text-gray-400 font-mono break-all line-clamp-1">
                                {session.user_agent}
                              </p>

                              <div className="flex items-center justify-between text-[11px] text-gray-500 pt-1 border-t border-white/5">
                                <span>
                                  Tạo lúc:{" "}
                                  {new Date(session.created_at).toLocaleString(
                                    "vi-VN",
                                  )}
                                </span>
                                <span>
                                  Truy cập:{" "}
                                  {new Date(session.accessed_at).toLocaleString(
                                    "vi-VN",
                                  )}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-white/[0.02] border-t border-white/10 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setSelectedUserId(null);
                  setUserDetail(null);
                }}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors text-sm font-medium"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {userToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in">
          <div className="bg-[#141419] border border-white/10 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Edit2 size={18} className="text-blue-400" />
                <span>Chỉnh sửa người dùng</span>
              </h3>
              <button
                onClick={() => setUserToEdit(null)}
                className="text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Tên hiển thị (Nickname) *
                </label>
                <input
                  type="text"
                  required
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Nhập nickname..."
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="name@example.com (để trống nếu không có)"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setUserToEdit(null)}
                  disabled={editLoading}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-medium transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={editLoading || !editNickname.trim()}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-sm font-semibold transition-all flex items-center gap-2 shadow-lg shadow-blue-900/30 disabled:opacity-50"
                >
                  {editLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Check size={16} />
                  )}
                  <span>Lưu thay đổi</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Modal */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in">
          <div className="bg-[#141419] border border-red-500/20 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-white/10 flex items-center gap-3 text-red-400">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Xác nhận xóa tài khoản</h3>
                <p className="text-xs text-gray-400">Hành động này không thể hoàn tác</p>
              </div>
            </div>

            <div className="p-6 space-y-3 text-sm text-gray-300">
              <p>
                Bạn có chắc chắn muốn xóa tài khoản{" "}
                <span className="font-bold text-white">
                  "{userToDelete.nickname}"
                </span>{" "}
                (ID:{" "}
                <span className="font-mono text-xs text-gray-400">
                  {userToDelete.id}
                </span>
                )?
              </p>
              <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20 text-xs text-red-300 space-y-1">
                <p className="font-semibold">Cảnh báo:</p>
                <p>
                  Toàn bộ dữ liệu của người dùng bao gồm Bookmarks (
                  {userToDelete.counts.bookmarks}), lịch sử xem (
                  {userToDelete.counts.watchHistory}), tiến độ phim, addons đã cài
                  và các phiên đăng nhập sẽ bị xóa vĩnh viễn khỏi cơ sở dữ liệu.
                </p>
              </div>
            </div>

            <div className="p-4 bg-white/[0.02] border-t border-white/10 flex items-center justify-end gap-3">
              <button
                onClick={() => setUserToDelete(null)}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-medium transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleteLoading}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 active:scale-95 text-white text-sm font-semibold transition-all flex items-center gap-2 shadow-lg shadow-red-900/30 disabled:opacity-50"
              >
                {deleteLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}
                <span>Xóa vĩnh viễn</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
