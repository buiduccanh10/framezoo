import {
  HardDrive,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquare,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export type AdminTab = "users" | "feedbacks" | "backups";

interface AdminShellProps {
  activeTab: AdminTab;
  pendingFeedbacks: number;
  totalUsers: number;
  onTabChange: (tab: AdminTab) => void;
  onLogout: () => void;
  children: ReactNode;
}

const SECTION_META: Record<AdminTab, { title: string; subtitle: string }> = {
  users: {
    title: "Quản lý người dùng",
    subtitle: "Tài khoản, phiên bản ứng dụng & phiên hoạt động",
  },
  feedbacks: {
    title: "Phản hồi người dùng",
    subtitle: "Hàng đợi hỗ trợ & tệp đính kèm",
  },
  backups: {
    title: "Sao lưu cơ sở dữ liệu",
    subtitle: "Tạo, tải xuống & phục hồi dữ liệu",
  },
};

export function AdminShell({
  activeTab,
  pendingFeedbacks,
  totalUsers,
  onTabChange,
  onLogout,
  children,
}: AdminShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const navItems = [
    {
      id: "users" as const,
      label: "Người dùng",
      icon: Users,
      count: totalUsers,
      badgeTone: "neutral",
    },
    {
      id: "feedbacks" as const,
      label: "Phản hồi",
      icon: MessageSquare,
      count: pendingFeedbacks,
      badgeTone: "amber",
    },
    {
      id: "backups" as const,
      label: "Sao lưu DB",
      icon: HardDrive,
      count: 0,
      badgeTone: "neutral",
    },
  ];

  const handleSelect = (tab: AdminTab) => {
    onTabChange(tab);
    setDrawerOpen(false);
  };

  const meta = SECTION_META[activeTab];

  return (
    <div className="admin-shell">
      {drawerOpen ? (
        <div
          className="sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <aside
        className={`admin-sidebar ${drawerOpen ? "is-open" : ""}`}
        aria-label="Điều hướng quản trị"
      >
        <div className="sidebar-brand">
          <div className="brand-lockup">
            <img src="/framezoo-logo.svg" alt="Framezoo" className="brand-mark" />
            <div>
              <p className="brand-name">Framezoo</p>
              <p className="brand-context">
                <ShieldCheck size={12} aria-hidden="true" /> Admin Console
              </p>
            </div>
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Đóng menu"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Mục quản lý">
          <p className="sidebar-label">Quản trị</p>
          {navItems.map(({ id, label, icon: Icon, count, badgeTone }) => (
            <button
              key={id}
              className={`nav-item ${activeTab === id ? "is-active" : ""}`}
              type="button"
              aria-current={activeTab === id ? "page" : undefined}
              onClick={() => handleSelect(id)}
            >
              <Icon size={17} aria-hidden="true" />
              <span className="nav-item-label">{label}</span>
              {count > 0 ? (
                <span className={`nav-badge tone-${badgeTone}`}>{count}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="security-pill">
            <LockKeyhole size={13} aria-hidden="true" />
            <span>Cookie HTTP-only · Riêng tư</span>
          </div>
          <button
            className="button button-quiet button-wide sidebar-logout"
            type="button"
            onClick={onLogout}
          >
            <LogOut size={16} aria-hidden="true" />
            Đăng xuất
          </button>
        </div>
      </aside>

      <div className="admin-content-wrap">
        <header className="admin-topbar">
          <div className="topbar-left">
            <button
              className="icon-button menu-toggle"
              type="button"
              aria-label="Mở menu điều hướng"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen((prev) => !prev)}
            >
              <Menu size={18} />
            </button>
            <div className="topbar-title">
              <span className="topbar-name">{meta.title}</span>
              <span className="topbar-subtitle">{meta.subtitle}</span>
            </div>
          </div>

          <div className="topbar-actions">
            <span className="topbar-security-tag">
              <ShieldCheck size={13} aria-hidden="true" />
              <span>Protected</span>
            </span>
            <button
              className="button button-quiet topbar-logout"
              type="button"
              onClick={onLogout}
            >
              <LogOut size={15} aria-hidden="true" />
              <span>Đăng xuất</span>
            </button>
          </div>
        </header>

        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
