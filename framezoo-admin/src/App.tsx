import { useCallback, useEffect, useState } from "react";
import { AdminShell, type AdminTab } from "./components/AdminHeader";
import { BackupManagement } from "./components/BackupManagement";
import { FeedbackManagement } from "./components/FeedbackManagement";
import { GuestManagement } from "./components/GuestManagement";
import { LoginScreen } from "./components/LoginScreen";
import { TakedownManagement } from "./components/TakedownManagement";
import { UserManagement } from "./components/UserManagement";
import { adminApi } from "./lib/api";
import { useAdminAuth } from "./hooks/useAdminAuth";
import { useToast } from "./hooks/useToast";
import type { FeedbackItem, TakedownTargetType } from "./types";

function inferTakedownTargetType(raw: string): TakedownTargetType {
  const value = raw.trim();
  if (/^tt\d+/i.test(value)) return "imdb_id";
  if (/^(?:movie:|tv:|series:)?\d+$/i.test(value)) return "tmdb_id";
  if (/^[a-f0-9]{40}$/i.test(value)) return "infohash";
  if (/^(subsource|opensubs|wyzie):/i.test(value)) return "subtitle_id";
  return "addon_domain";
}

function App() {
  const { authState, loginError, isLoggingIn, login, logout } = useAdminAuth();
  const { message, showMessage } = useToast();
  const [activeTab, setActiveTab] = useState<AdminTab>("users");
  const [totalUsers, setTotalUsers] = useState(0);
  const [activeGuests24h, setActiveGuests24h] = useState(0);
  const [pendingFeedbacks, setPendingFeedbacks] = useState(0);
  const [activeTakedowns, setActiveTakedowns] = useState(0);
  const [takedownPrefill, setTakedownPrefill] = useState<{
    targetType: TakedownTargetType;
    pattern: string;
    reason: string;
    rightsHolder?: string;
    referenceId?: string;
  } | null>(null);

  useEffect(() => {
    if (authState !== "authenticated") return;
    let cancelled = false;
    void adminApi
      .listFeedback(1, 1)
      .then((result) => {
        if (!cancelled) setPendingFeedbacks(result.stats.pending);
      })
      .catch(() => {});
    void adminApi
      .listGuests({ page: 1, limit: 1, window: "24h" })
      .then((result) => {
        if (!cancelled) setActiveGuests24h(result.stats.counts.h24);
      })
      .catch(() => {});
    void adminApi
      .listTakedowns({ active: "true" })
      .then((result) => {
        if (!cancelled) setActiveTakedowns(result.stats?.active ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authState]);

  const handleCreateTakedownFromFeedback = useCallback((item: FeedbackItem) => {
    const rawTarget = item.target_url_or_id || "";
    setTakedownPrefill({
      targetType: inferTakedownTargetType(rawTarget),
      pattern: rawTarget,
      reason: `DMCA #${item.id}: ${item.title}`,
      rightsHolder: item.rights_owner_name || undefined,
      referenceId: item.id,
    });
    setActiveTab("takedowns");
  }, []);

  const clearTakedownPrefill = useCallback(() => setTakedownPrefill(null), []);

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
      activeTakedowns={activeTakedowns}
      totalUsers={totalUsers}
      activeGuests24h={activeGuests24h}
      onTabChange={(nextTab) => {
        if (nextTab !== "takedowns" && takedownPrefill) {
          clearTakedownPrefill();
        }
        setActiveTab(nextTab);
      }}
      onLogout={() => void handleLogout()}
    >
      {activeTab === "users" ? (
        <UserManagement
          api={adminApi}
          showMessage={showMessage}
          onStatsUpdate={setTotalUsers}
        />
      ) : null}
      {activeTab === "guests" ? (
        <GuestManagement
          api={adminApi}
          showMessage={showMessage}
          onStatsUpdate={setActiveGuests24h}
        />
      ) : null}
      {activeTab === "feedbacks" ? (
        <FeedbackManagement
          onMessage={showMessage}
          onPendingChange={setPendingFeedbacks}
          onCreateTakedown={handleCreateTakedownFromFeedback}
        />
      ) : null}
      {activeTab === "takedowns" ? (
        <TakedownManagement
          key={takedownPrefill?.referenceId || "default"}
          onMessage={showMessage}
          onActiveCountChange={setActiveTakedowns}
          prefill={takedownPrefill}
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
