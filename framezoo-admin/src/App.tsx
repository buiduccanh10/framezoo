import { useEffect, useState } from "react";
import { AdminShell, type AdminTab } from "./components/AdminHeader";
import { BackupManagement } from "./components/BackupManagement";
import { FeedbackManagement } from "./components/FeedbackManagement";
import { LoginScreen } from "./components/LoginScreen";
import { UserManagement } from "./components/UserManagement";
import { adminApi } from "./lib/api";
import { useAdminAuth } from "./hooks/useAdminAuth";
import { useToast } from "./hooks/useToast";

function App() {
  const { authState, loginError, isLoggingIn, login, logout } = useAdminAuth();
  const { message, showMessage } = useToast();
  const [activeTab, setActiveTab] = useState<AdminTab>("users");
  const [totalUsers, setTotalUsers] = useState(0);
  const [pendingFeedbacks, setPendingFeedbacks] = useState(0);

  useEffect(() => {
    if (authState !== "authenticated") return;
    let cancelled = false;
    void adminApi
      .listFeedback(1, 1)
      .then((result) => {
        if (!cancelled) setPendingFeedbacks(result.stats.pending);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authState]);

  const handleLogout = async () => {
    if (!(await logout())) {
      showMessage("Không thể đăng xuất. Kiểm tra kết nối và thử lại.");
    }
  };

  if (authState === "checking") {
    return (
      <main className="auth-shell">
        <div className="auth-loading" aria-live="polite">
          Đang kiểm tra phiên quản trị…
        </div>
      </main>
    );
  }

  if (authState === "anonymous") {
    return (
      <LoginScreen
        busy={isLoggingIn}
        error={loginError}
        onSubmit={(username, password) => void login(username, password)}
      />
    );
  }

  return (
    <AdminShell
      activeTab={activeTab}
      pendingFeedbacks={pendingFeedbacks}
      totalUsers={totalUsers}
      onTabChange={setActiveTab}
      onLogout={() => void handleLogout()}
    >
      {activeTab === "users" ? (
        <UserManagement
          api={adminApi}
          showMessage={showMessage}
          onStatsUpdate={setTotalUsers}
        />
      ) : null}
      {activeTab === "feedbacks" ? (
        <FeedbackManagement
          onMessage={showMessage}
          onPendingChange={setPendingFeedbacks}
        />
      ) : null}
      {activeTab === "backups" ? (
        <BackupManagement onMessage={showMessage} />
      ) : null}
      {message ? (
        <div className="toast" role="status">
          {message}
        </div>
      ) : null}
    </AdminShell>
  );
}

export default App;
