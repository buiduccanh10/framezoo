import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import {
  Database,
  Download,
  Trash2,
  UploadCloud,
  Play,
  CheckCircle,
  AlertCircle,
  Loader2,
  LogOut,
  HardDrive,
  MessageSquare,
  Check,
  RotateCcw,
  User,
  Users,
  Clock,
  Search,
  Eye,
  X,
} from "lucide-react";
import { UserManagement } from "./components/UserManagement";

const API_BASE = "/api";

interface FeedbackUser {
  id: string;
  nickname: string;
  email: string | null;
}

interface FeedbackItem {
  id: string;
  title: string;
  description: string;
  status: "pending" | "resolved" | string;
  user_id: string | null;
  user: FeedbackUser | null;
  created_at: string;
  updated_at: string;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("admin_token") || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Navigation tab: "users", "feedbacks" or "backups"
  const [activeTab, setActiveTab] = useState<"users" | "feedbacks" | "backups">(
    "users",
  );
  const [totalUsersCount, setTotalUsersCount] = useState<number>(0);

  // Backups state
  const [status, setStatus] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Feedback state
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState<
    "all" | "pending" | "resolved"
  >("all");
  const [feedbackSearch, setFeedbackSearch] = useState("");
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(
    null,
  );
  const [updatingFeedbackId, setUpdatingFeedbackId] = useState<string | null>(
    null,
  );

  const api = useMemo(() => {
    const instance = axios.create({ baseURL: API_BASE });
    instance.interceptors.request.use((config) => {
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
    instance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401 || error.response?.status === 403) {
          handleLogout();
        }
        return Promise.reject(error);
      },
    );
    return instance;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(""), 3500);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError("");
    try {
      const res = await axios.post(`${API_BASE}/backup/login`, {
        username,
        password,
      });
      if (res.data.success) {
        const t = res.data.token;
        setToken(t);
        localStorage.setItem("admin_token", t);
        setUsername("");
        setPassword("");
      }
    } catch (err: any) {
      setLoginError(err.response?.data?.message || "Login failed");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setToken("");
    localStorage.removeItem("admin_token");
    setStatus(null);
    setFiles([]);
    setFeedbacks([]);
    setTotalUsersCount(0);
  };

  const loadBackupData = async () => {
    try {
      const [statusRes, filesRes] = await Promise.all([
        api.get("/backup/status"),
        api.get("/backup/files"),
      ]);
      setStatus(statusRes.data);
      setFiles(filesRes.data.files || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadFeedbackData = async () => {
    setFeedbackLoading(true);
    try {
      const res = await api.get("/feedback");
      if (res.data.success) {
        setFeedbacks(res.data.feedbacks || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setFeedbackLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;

    let active = true;
    const fetchInitialData = async () => {
      setLoading(true);
      try {
        const [statusRes, filesRes, feedbackRes] = await Promise.all([
          api.get("/backup/status"),
          api.get("/backup/files"),
          api
            .get("/feedback")
            .catch(() => ({ data: { success: false, feedbacks: [] } })),
        ]);
        if (active) {
          setStatus(statusRes.data);
          setFiles(filesRes.data.files || []);
          if (feedbackRes.data?.success) {
            setFeedbacks(feedbackRes.data.feedbacks || []);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchInitialData();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Backup operations
  const triggerManualBackup = async () => {
    setActionLoading(true);
    try {
      const res = await api.post("/backup/manual");
      showMessage(res.data.message || "Backup completed!");
      loadBackupData();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to trigger backup");
    } finally {
      setActionLoading(false);
    }
  };

  const downloadFile = async (filename: string) => {
    window.open(
      `${API_BASE}/backup/download/${filename}?token=${token}`,
      "_blank",
    );
  };

  const deleteFile = async (filename: string) => {
    if (!window.confirm(`Are you sure you want to delete ${filename}?`)) return;
    setActionLoading(true);
    try {
      const res = await api.delete(`/backup/delete/${filename}`);
      showMessage(res.data.message || "File deleted");
      loadBackupData();
    } catch (err: any) {
      alert(err.response?.data?.message || "Delete failed");
    } finally {
      setActionLoading(false);
    }
  };

  const deleteAll = async () => {
    if (!window.confirm("Delete ALL backups? This cannot be undone.")) return;
    setActionLoading(true);
    try {
      const res = await api.delete("/backup/delete-all");
      showMessage(res.data.message || "All backups deleted");
      loadBackupData();
    } catch (err: any) {
      alert(err.response?.data?.message || "Delete failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !window.confirm(
        `Restore database from ${file.name}? This will overwrite current data!`,
      )
    ) {
      e.target.value = "";
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setActionLoading(true);
    try {
      const res = await api.post("/backup/import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      showMessage(res.data.message || "Restore completed successfully");
    } catch (err: any) {
      alert(err.response?.data?.message || "Restore failed");
    } finally {
      setActionLoading(false);
      e.target.value = "";
    }
  };

  // Feedback operations
  const handleUpdateStatus = async (
    id: string,
    newStatus: "pending" | "resolved",
  ) => {
    setUpdatingFeedbackId(id);
    try {
      const res = await api.patch(`/feedback/${id}`, { status: newStatus });
      if (res.data.success) {
        setFeedbacks((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: newStatus,
                  updated_at: res.data.feedback.updated_at,
                }
              : item,
          ),
        );
        if (selectedFeedback && selectedFeedback.id === id) {
          setSelectedFeedback((prev) =>
            prev ? { ...prev, status: newStatus } : null,
          );
        }
        showMessage(
          newStatus === "resolved"
            ? "Đã xác nhận xử lý xong feedback!"
            : "Đã chuyển feedback về trạng thái đang xử lý",
        );
      }
    } catch (err: any) {
      alert(err.response?.data?.message || "Cập nhật trạng thái thất bại");
    } finally {
      setUpdatingFeedbackId(null);
    }
  };

  const handleDeleteFeedback = async (id: string) => {
    if (!window.confirm("Bạn có chắc chắn muốn xóa phản hồi này không?"))
      return;
    setUpdatingFeedbackId(id);
    try {
      const res = await api.delete(`/feedback/${id}`);
      if (res.data.success) {
        setFeedbacks((prev) => prev.filter((item) => item.id !== id));
        if (selectedFeedback && selectedFeedback.id === id) {
          setSelectedFeedback(null);
        }
        showMessage("Đã xóa phản hồi thành công");
      }
    } catch (err: any) {
      alert(err.response?.data?.message || "Xóa phản hồi thất bại");
    } finally {
      setUpdatingFeedbackId(null);
    }
  };

  // Filtered feedbacks
  const filteredFeedbacks = useMemo(() => {
    return feedbacks.filter((item) => {
      if (feedbackFilter === "pending" && item.status !== "pending")
        return false;
      if (feedbackFilter === "resolved" && item.status !== "resolved")
        return false;

      if (feedbackSearch.trim()) {
        const query = feedbackSearch.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(query);
        const matchesDesc = item.description.toLowerCase().includes(query);
        const matchesUser =
          item.user?.nickname?.toLowerCase().includes(query) || false;
        return matchesTitle || matchesDesc || matchesUser;
      }
      return true;
    });
  }, [feedbacks, feedbackFilter, feedbackSearch]);

  const pendingCount = useMemo(
    () => feedbacks.filter((f) => f.status === "pending").length,
    [feedbacks],
  );

  const resolvedCount = useMemo(
    () => feedbacks.filter((f) => f.status === "resolved").length,
    [feedbacks],
  );

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
        <div className="absolute inset-0 z-0 opacity-20">
          <div className="absolute -top-40 -left-40 w-96 h-96 bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob"></div>
          <div className="absolute top-0 -right-40 w-96 h-96 bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-2000"></div>
          <div className="absolute -bottom-40 left-20 w-96 h-96 bg-pink-600 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-4000"></div>
        </div>

        <div className="z-10 bg-white/5 backdrop-blur-xl p-8 rounded-2xl shadow-2xl border border-white/10 w-full max-w-md">
          <div className="text-center mb-8">
            <img
              src="/framezoo-logo.svg"
              alt="Framezoo Logo"
              className="w-16 h-16 mx-auto mb-4"
            />
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
              Framezoo Admin
            </h1>
            <p className="text-gray-400 mt-2">Management Portal</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                required
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                required
              />
            </div>
            {loginError && (
              <div className="text-red-400 text-sm flex items-center gap-2">
                <AlertCircle size={16} /> {loginError}
              </div>
            )}
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold py-3 rounded-lg transition-all transform hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 disabled:opacity-70 disabled:pointer-events-none"
            >
              {isLoggingIn ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                "Login to Dashboard"
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-gray-100 p-4 md:p-8">
      {/* Header */}
      <header className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center">
            <img
              src="/framezoo-logo.svg"
              alt="Framezoo Logo"
              className="w-8 h-8"
            />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Framezoo Admin
            </h1>
            <p className="text-sm text-gray-400">
              Quản trị hệ thống và phản hồi
            </p>
          </div>
        </div>

        {/* Tab switch & Logout */}
        <div className="flex items-center gap-3">
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
            <button
              onClick={() => setActiveTab("users")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === "users"
                  ? "bg-blue-600 text-white shadow"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <Users size={16} />
              <span>Người dùng</span>
              {totalUsersCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-blue-500/20 text-blue-200">
                  {totalUsersCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("feedbacks")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === "feedbacks"
                  ? "bg-blue-600 text-white shadow"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <MessageSquare size={16} />
              <span>Phản hồi</span>
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-500 text-black">
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("backups")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === "backups"
                  ? "bg-blue-600 text-white shadow"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <HardDrive size={16} />
              <span>Sao lưu DB</span>
            </button>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-sm font-medium text-gray-300 hover:text-white"
          >
            <LogOut size={16} /> Đăng xuất
          </button>
        </div>
      </header>

      {/* Main Content: USERS TAB */}
      {activeTab === "users" && (
        <main className="max-w-6xl mx-auto space-y-6">
          <UserManagement
            api={api}
            showMessage={showMessage}
            onStatsUpdate={(total) => setTotalUsersCount(total)}
          />
        </main>
      )}

      {/* Main Content: FEEDBACKS TAB */}
      {activeTab === "feedbacks" && (
        <main className="max-w-6xl mx-auto space-y-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-400">
                  Tổng phản hồi
                </span>
                <MessageSquare size={20} className="text-blue-400" />
              </div>
              <p className="mt-2 text-3xl font-bold font-mono text-white">
                {feedbacks.length}
              </p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-amber-300">
                  Đang xử lý
                </span>
                <Clock size={20} className="text-amber-400" />
              </div>
              <p className="mt-2 text-3xl font-bold font-mono text-amber-400">
                {pendingCount}
              </p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-emerald-300">
                  Đã fix
                </span>
                <CheckCircle size={20} className="text-emerald-400" />
              </div>
              <p className="mt-2 text-3xl font-bold font-mono text-emerald-400">
                {resolvedCount}
              </p>
            </div>
          </div>

          {/* Controls: Search & Filters */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur-sm flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="relative w-full md:w-80">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Tìm tiêu đề, nội dung, người dùng..."
                value={feedbackSearch}
                onChange={(e) => setFeedbackSearch(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
              <div className="flex bg-black/30 p-1 rounded-xl border border-white/10 text-xs font-medium">
                <button
                  onClick={() => setFeedbackFilter("all")}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    feedbackFilter === "all"
                      ? "bg-white/20 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  Tất cả ({feedbacks.length})
                </button>
                <button
                  onClick={() => setFeedbackFilter("pending")}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    feedbackFilter === "pending"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  Đang xử lý ({pendingCount})
                </button>
                <button
                  onClick={() => setFeedbackFilter("resolved")}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    feedbackFilter === "resolved"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  Đã fix ({resolvedCount})
                </button>
              </div>

              <button
                onClick={loadFeedbackData}
                disabled={feedbackLoading}
                className="px-3 py-2 text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-300 hover:text-white transition-colors"
                title="Làm mới danh sách"
              >
                {feedbackLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  "Làm mới"
                )}
              </button>
            </div>
          </div>

          {/* Feedbacks List */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm min-h-[400px]">
            {feedbackLoading ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <Loader2
                  size={32}
                  className="animate-spin mb-4 text-blue-500"
                />
                Đang tải danh sách phản hồi...
              </div>
            ) : filteredFeedbacks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-500 border border-dashed border-white/10 rounded-xl bg-black/20">
                <MessageSquare size={48} className="mb-4 opacity-50" />
                <p className="font-medium">Chưa có phản hồi nào</p>
                <p className="text-xs text-gray-500 mt-1">
                  Khi người dùng gửi feedback từ app hoặc web, danh sách sẽ hiển
                  thị tại đây.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredFeedbacks.map((item) => {
                  const isPending = item.status === "pending";
                  const isUpdating = updatingFeedbackId === item.id;

                  return (
                    <div
                      key={item.id}
                      className="flex flex-col lg:flex-row lg:items-center justify-between p-4 rounded-xl bg-black/30 border border-white/5 hover:border-white/20 transition-all gap-4 group"
                    >
                      {/* Left: Info */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3
                            className="font-semibold text-white text-base truncate max-w-md"
                            title={item.title}
                          >
                            {item.title}
                          </h3>

                          {/* Status Badge */}
                          {isPending ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                              Đang xử lý
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                              <Check size={12} />
                              Đã fix
                            </span>
                          )}

                          {/* User tag: only if logged in user */}
                          {item.user ? (
                            <span
                              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs bg-blue-500/10 text-blue-300 border border-blue-500/20"
                              title={
                                item.user.email
                                  ? `Email: ${item.user.email}`
                                  : undefined
                              }
                            >
                              <User size={12} />
                              <span>{item.user.nickname || "User"}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-gray-500 bg-white/5 border border-white/5">
                              Khách
                            </span>
                          )}
                        </div>

                        <p className="text-sm text-gray-300 line-clamp-2 leading-relaxed">
                          {item.description}
                        </p>

                        <div className="flex items-center gap-4 text-xs text-gray-500 pt-1">
                          <span>
                            Gửi lúc:{" "}
                            {new Date(item.created_at).toLocaleString("vi-VN")}
                          </span>
                          {item.updated_at &&
                            item.updated_at !== item.created_at && (
                              <>
                                <span className="w-1 h-1 rounded-full bg-gray-600"></span>
                                <span>
                                  Cập nhật:{" "}
                                  {new Date(item.updated_at).toLocaleString(
                                    "vi-VN",
                                  )}
                                </span>
                              </>
                            )}
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 shrink-0 self-end lg:self-center">
                        <button
                          onClick={() => setSelectedFeedback(item)}
                          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors text-xs font-medium flex items-center gap-1.5 border border-white/10"
                          title="Xem chi tiết"
                        >
                          <Eye size={14} />
                          <span>Chi tiết</span>
                        </button>

                        {/* Confirmation Button for Feedback */}
                        {isPending ? (
                          <button
                            onClick={() =>
                              handleUpdateStatus(item.id, "resolved")
                            }
                            disabled={isUpdating}
                            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-emerald-900/30 disabled:opacity-50"
                            title="Xác nhận dev đã fix xong vấn đề"
                          >
                            {isUpdating ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <CheckCircle size={14} />
                            )}
                            <span>Xác nhận đã fix</span>
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              handleUpdateStatus(item.id, "pending")
                            }
                            disabled={isUpdating}
                            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-gray-300 hover:text-white transition-colors text-xs font-medium flex items-center gap-1.5 border border-white/10 disabled:opacity-50"
                            title="Đổi lại thành trạng thái Đang xử lý"
                          >
                            {isUpdating ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <RotateCcw size={14} />
                            )}
                            <span>Chưa fix</span>
                          </button>
                        )}

                        <button
                          onClick={() => handleDeleteFeedback(item.id)}
                          disabled={isUpdating}
                          className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors border border-red-500/20"
                          title="Xóa phản hồi"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Feedback Detail Modal */}
          {selectedFeedback && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-[#18181b] border border-white/15 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="text-xs font-mono text-gray-500 uppercase">
                      Chi tiết phản hồi
                    </span>
                    <h2 className="text-xl font-bold text-white mt-1">
                      {selectedFeedback.title}
                    </h2>
                  </div>
                  <button
                    onClick={() => setSelectedFeedback(null)}
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="flex items-center gap-3 text-xs flex-wrap">
                  {selectedFeedback.status === "pending" ? (
                    <span className="px-2.5 py-0.5 rounded-full font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                      Trạng thái: Đang xử lý
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                      <Check size={12} />
                      Trạng thái: Đã fix
                    </span>
                  )}

                  {selectedFeedback.user ? (
                    <span className="px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20 flex items-center gap-1">
                      <User size={12} />
                      Tài khoản: {selectedFeedback.user.nickname}
                      {selectedFeedback.user.email
                        ? ` (${selectedFeedback.user.email})`
                        : ""}
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/5">
                      Người gửi: Khách (chưa đăng nhập)
                    </span>
                  )}

                  <span className="text-gray-500">
                    Thời gian:{" "}
                    {new Date(selectedFeedback.created_at).toLocaleString(
                      "vi-VN",
                    )}
                  </span>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Nội dung mô tả vấn đề:
                  </label>
                  <div className="bg-black/40 border border-white/10 rounded-xl p-4 text-gray-200 text-sm whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                    {selectedFeedback.description}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
                  <button
                    onClick={() => setSelectedFeedback(null)}
                    className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors text-sm font-medium"
                  >
                    Đóng
                  </button>

                  {selectedFeedback.status === "pending" ? (
                    <button
                      onClick={() =>
                        handleUpdateStatus(selectedFeedback.id, "resolved")
                      }
                      disabled={updatingFeedbackId === selectedFeedback.id}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/40 disabled:opacity-50"
                    >
                      {updatingFeedbackId === selectedFeedback.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <CheckCircle size={16} />
                      )}
                      Xác nhận đã fix
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        handleUpdateStatus(selectedFeedback.id, "pending")
                      }
                      disabled={updatingFeedbackId === selectedFeedback.id}
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-300 font-medium text-sm flex items-center gap-2 disabled:opacity-50"
                    >
                      {updatingFeedbackId === selectedFeedback.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <RotateCcw size={16} />
                      )}
                      Đánh dấu đang xử lý
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      )}

      {/* Main Content: BACKUPS TAB */}
      {activeTab === "backups" && (
        <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Col - Stats & Actions */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
              <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                <HardDrive size={20} className="text-blue-400" />
                Tổng quan lưu trữ
              </h2>

              <div className="space-y-4">
                <div className="flex justify-between items-center p-3 rounded-lg bg-black/20 border border-white/5">
                  <span className="text-gray-400">Tổng bản sao lưu</span>
                  <span className="font-mono text-xl font-medium">
                    {status?.totalBackups || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-black/20 border border-white/5">
                  <span className="text-gray-400">Dung lượng</span>
                  <span className="font-mono text-xl font-medium text-blue-400">
                    {status?.backupSize || "0 MB"}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-black/20 border border-white/5">
                  <span className="text-gray-400">Bản mới nhất</span>
                  <span
                    className="font-mono text-sm truncate max-w-[150px]"
                    title={status?.latestBackup}
                  >
                    {status?.latestBackup
                      ? status.latestBackup.replace("framezoo-backup-", "")
                      : "Chưa có"}
                  </span>
                </div>
              </div>

              <div className="mt-8 space-y-3">
                <button
                  onClick={triggerManualBackup}
                  disabled={actionLoading}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  {actionLoading ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Play size={18} />
                  )}
                  Tạo bản sao lưu ngay
                </button>

                <label className="w-full bg-white/10 hover:bg-white/15 border border-dashed border-white/20 text-white font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer">
                  <UploadCloud size={18} />
                  Phục hồi cơ sở dữ liệu
                  <input
                    type="file"
                    accept=".tar.gz,.gz,application/gzip,application/x-gzip,.sql,text/plain,application/sql"
                    className="hidden"
                    onChange={handleFileUpload}
                    disabled={actionLoading}
                  />
                </label>

                {files.length > 0 && (
                  <button
                    onClick={deleteAll}
                    disabled={actionLoading}
                    className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 mt-4"
                  >
                    <Trash2 size={18} /> Xóa toàn bộ bản sao lưu
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Col - List */}
          <div className="lg:col-span-2">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm min-h-[500px]">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold">Lịch sử sao lưu</h2>
                <button
                  onClick={loadBackupData}
                  className="text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Làm mới
                </button>
              </div>

              {loading ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                  <Loader2
                    size={32}
                    className="animate-spin mb-4 text-blue-500"
                  />
                  Đang tải danh sách sao lưu...
                </div>
              ) : files.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500 border border-dashed border-white/10 rounded-xl bg-black/20">
                  <Database size={48} className="mb-4 opacity-50" />
                  <p>Chưa có bản sao lưu nào</p>
                  <p className="text-sm mt-1">
                    Hãy tạo bản sao lưu thủ công để bắt đầu.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {files.map((file, i) => (
                    <div
                      key={i}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-black/30 border border-white/5 hover:border-white/20 transition-all group"
                    >
                      <div className="mb-3 sm:mb-0">
                        <div className="font-medium text-gray-200">
                          {file.name}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
                          <span>
                            {new Date(file.created).toLocaleString("vi-VN")}
                          </span>
                          <span className="w-1 h-1 rounded-full bg-gray-600"></span>
                          <span>{file.size}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => downloadFile(file.name)}
                          className="p-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                          title="Tải về"
                        >
                          <Download size={18} />
                        </button>
                        <button
                          onClick={() => deleteFile(file.name)}
                          className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                          title="Xóa"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      )}

      {/* Toast */}
      {message && (
        <div className="fixed bottom-6 right-6 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 z-50 backdrop-blur-md">
          <CheckCircle size={20} className="text-emerald-400" />
          <span className="font-medium">{message}</span>
        </div>
      )}
    </div>
  );
}

export default App;
