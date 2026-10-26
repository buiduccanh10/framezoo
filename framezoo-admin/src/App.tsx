import { useState } from "react";
import { AdminHeader, type AdminTab } from "./components/AdminHeader";
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

  const handleLogout = async () => {
    if (!(await logout())) showMessage("Không thể đăng xuất. Kiểm tra kết nối và thử lại.");
  };

  if (authState === "checking") {
    return <main className="auth-shell"><div className="auth-loading" aria-live="polite">Đang kiểm tra phiên quản trị…</div></main>;
  }

  if (authState === "anonymous") {
    return <LoginScreen busy={isLoggingIn} error={loginError} onSubmit={(username, password) => void login(username, password)} />;
  }

  return (
    <div className="admin-app">
      <AdminHeader activeTab={activeTab} pendingFeedbacks={pendingFeedbacks} totalUsers={totalUsers} onTabChange={setActiveTab} onLogout={() => void handleLogout()} />
      <main className="admin-main">
        {activeTab === "users" ? <UserManagement api={adminApi} showMessage={showMessage} onStatsUpdate={setTotalUsers} /> : null}
        {activeTab === "feedbacks" ? <FeedbackManagement onMessage={showMessage} onPendingChange={setPendingFeedbacks} /> : null}
        {activeTab === "backups" ? <BackupManagement onMessage={showMessage} /> : null}
      </main>
      {message ? <div className="toast" role="status">{message}</div> : null}
    </div>
  );
}

export default App;
