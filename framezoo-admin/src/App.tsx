import React, { useState, useEffect } from "react";
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
} from "lucide-react";

const API_BASE = "/api/backup";

function App() {
  const [token, setToken] = useState(localStorage.getItem("admin_token") || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [status, setStatus] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState("");

  const api = React.useMemo(() => {
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError("");
    try {
      const res = await axios.post(`${API_BASE}/login`, { username, password });
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
  };

  const loadData = async () => {
    try {
      const [statusRes, filesRes] = await Promise.all([
        api.get("/status"),
        api.get("/files"),
      ]);
      setStatus(statusRes.data);
      setFiles(filesRes.data.files || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!token) return;

    let active = true;
    const fetchInitialData = async () => {
      setLoading(true);
      try {
        const [statusRes, filesRes] = await Promise.all([
          api.get("/status"),
          api.get("/files"),
        ]);
        if (active) {
          setStatus(statusRes.data);
          setFiles(filesRes.data.files || []);
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

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(""), 3000);
  };

  const triggerManualBackup = async () => {
    setActionLoading(true);
    try {
      const res = await api.post("/manual");
      showMessage(res.data.message || "Backup completed!");
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to trigger backup");
    } finally {
      setActionLoading(false);
    }
  };

  const downloadFile = async (filename: string) => {
    window.open(`${API_BASE}/download/${filename}?token=${token}`, "_blank");
  };

  const deleteFile = async (filename: string) => {
    if (!window.confirm(`Are you sure you want to delete ${filename}?`)) return;
    setActionLoading(true);
    try {
      const res = await api.delete(`/delete/${filename}`);
      showMessage(res.data.message || "File deleted");
      loadData();
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
      const res = await api.delete("/delete-all");
      showMessage(res.data.message || "All backups deleted");
      loadData();
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
      const res = await api.post("/import", formData, {
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

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#0b0b0f]">
        <div className="absolute inset-0 z-0 opacity-20">
          <div className="absolute -top-40 -left-40 w-96 h-96 bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob"></div>
          <div className="absolute top-0 -right-40 w-96 h-96 bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-2000"></div>
          <div className="absolute -bottom-40 left-20 w-96 h-96 bg-pink-600 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-4000"></div>
        </div>

        <div className="z-10 bg-white/5 backdrop-blur-xl p-8 rounded-2xl shadow-2xl border border-white/10 w-full max-w-md">
          <div className="text-center mb-8">
            <Database className="w-12 h-12 text-blue-400 mx-auto mb-4" />
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
              Framezoo Admin
            </h1>
            <p className="text-gray-400 mt-2">Database Management Portal</p>
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
    <div className="min-h-screen bg-[#0b0b0f] text-gray-100 p-4 md:p-8">
      {/* Header */}
      <header className="max-w-6xl mx-auto flex items-center justify-between mb-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              System Backups
            </h1>
            <p className="text-sm text-gray-400">
              Manage Supabase database backups
            </p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-sm font-medium"
        >
          <LogOut size={16} /> Logout
        </button>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Col - Stats & Actions */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
            <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
              <HardDrive size={20} className="text-blue-400" />
              Storage Overview
            </h2>

            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 rounded-lg bg-black/20 border border-white/5">
                <span className="text-gray-400">Total Backups</span>
                <span className="font-mono text-xl font-medium">
                  {status?.totalBackups || 0}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 rounded-lg bg-black/20 border border-white/5">
                <span className="text-gray-400">Total Size</span>
                <span className="font-mono text-xl font-medium text-blue-400">
                  {status?.backupSize || "0 MB"}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 rounded-lg bg-black/20 border border-white/5">
                <span className="text-gray-400">Latest</span>
                <span
                  className="font-mono text-sm truncate max-w-[150px]"
                  title={status?.latestBackup}
                >
                  {status?.latestBackup
                    ? status.latestBackup.replace("framezoo-backup-", "")
                    : "None"}
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
                Run Backup Now
              </button>

              <label className="w-full bg-white/10 hover:bg-white/15 border border-dashed border-white/20 text-white font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer">
                <UploadCloud size={18} />
                Restore Database
                <input
                  type="file"
                  accept=".tar.gz,.sql"
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
                  <Trash2 size={18} /> Delete All Backups
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Col - List */}
        <div className="lg:col-span-2">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm min-h-[500px]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">Backup History</h2>
              <button
                onClick={loadData}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Refresh
              </button>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <Loader2
                  size={32}
                  className="animate-spin mb-4 text-blue-500"
                />
                Loading backups...
              </div>
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-500 border border-dashed border-white/10 rounded-xl bg-black/20">
                <Database size={48} className="mb-4 opacity-50" />
                <p>No backups found</p>
                <p className="text-sm mt-1">
                  Run a manual backup to get started.
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
                        <span>{new Date(file.created).toLocaleString()}</span>
                        <span className="w-1 h-1 rounded-full bg-gray-600"></span>
                        <span>{file.size}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => downloadFile(file.name)}
                        className="p-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                        title="Download"
                      >
                        <Download size={18} />
                      </button>
                      <button
                        onClick={() => deleteFile(file.name)}
                        className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                        title="Delete"
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

      {/* Toast */}
      {message && (
        <div className="fixed bottom-6 right-6 bg-green-500/10 border border-green-500/20 text-green-400 px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle size={20} />
          <span className="font-medium">{message}</span>
        </div>
      )}
    </div>
  );
}

export default App;
