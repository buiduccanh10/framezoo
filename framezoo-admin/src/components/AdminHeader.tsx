import {
  HardDrive,
  LogOut,
  MessageSquare,
  ShieldCheck,
  Users,
} from "lucide-react";

export type AdminTab = "users" | "feedbacks" | "backups";

interface AdminHeaderProps {
  activeTab: AdminTab;
  pendingFeedbacks: number;
  totalUsers: number;
  onTabChange: (tab: AdminTab) => void;
  onLogout: () => void;
}

export function AdminHeader({
  activeTab,
  pendingFeedbacks,
  totalUsers,
  onTabChange,
  onLogout,
}: AdminHeaderProps) {
  const tabs = [
    { id: "users" as const, label: "Người dùng", icon: Users, count: totalUsers },
    {
      id: "feedbacks" as const,
      label: "Phản hồi",
      icon: MessageSquare,
      count: pendingFeedbacks,
    },
    { id: "backups" as const, label: "Sao lưu DB", icon: HardDrive },
  ];

  return (
    <header className="admin-header">
      <div className="brand-lockup">
        <img src="/framezoo-logo.svg" alt="Framezoo" className="brand-mark" />
        <div>
          <p className="brand-name">Framezoo</p>
          <p className="brand-context">
            <ShieldCheck size={13} aria-hidden="true" /> Admin workspace
          </p>
        </div>
      </div>

      <nav className="admin-tabs" aria-label="Admin sections">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            className={`tab-button ${activeTab === id ? "is-active" : ""}`}
            type="button"
            aria-current={activeTab === id ? "page" : undefined}
            onClick={() => onTabChange(id)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
            {count ? <span className="tab-count">{count}</span> : null}
          </button>
        ))}
      </nav>

      <button className="button button-quiet" type="button" onClick={onLogout}>
        <LogOut size={16} aria-hidden="true" />
        Đăng xuất
      </button>
    </header>
  );
}
