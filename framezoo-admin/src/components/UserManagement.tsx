import {
  AlertTriangle,
  Bookmark,
  Check,
  Clock,
  Copy,
  Edit2,
  Eye,
  Film,
  Loader2,
  LogOut,
  Mail,
  Puzzle,
  RotateCcw,
  Search,
  Smartphone,
  Sliders,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Pagination } from "./Pagination";
import { useUserManagement } from "../hooks/useUserManagement";
import type { adminApi } from "../lib/api";
import type {
  AdminUserItem,
  UserInstalledAddon,
  UserSessionItem,
} from "../types";

interface UserManagementProps {
  api: typeof adminApi;
  showMessage: (message: string) => void;
  onStatsUpdate?: (total: number) => void;
}

export function UserManagement({
  api,
  showMessage,
  onStatsUpdate,
}: UserManagementProps) {
  const users = useUserManagement(api, showMessage, onStatsUpdate);
  return (
    <section className="workspace-section" aria-labelledby="users-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Account directory</p>
          <h1 id="users-heading">Người dùng</h1>
          <p className="section-lede">
            Kiểm tra tài khoản, thiết bị và quyền truy cập theo trang.
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void users.loadUsers()}
          disabled={users.loading}
        >
          {users.loading ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <RotateCcw size={16} />
          )}{" "}
          Làm mới
        </button>
      </div>
      <div className="metric-grid metric-grid-four">
        <UserMetric
          label="Tổng người dùng"
          value={users.stats.totalUsers}
          icon={<Users size={17} />}
          tone="blue"
        />
        <UserMetric
          label="Hoạt động 30 ngày"
          value={users.stats.activeRecently}
          icon={<Clock size={17} />}
          tone="green"
        />
        <UserMetric
          label="Có email"
          value={users.stats.usersWithEmail}
          icon={<Mail size={17} />}
          tone="amber"
        />
        <UserMetric
          label="Phiên hoạt động"
          value={users.stats.totalSessions}
          icon={<Smartphone size={17} />}
          tone="red"
        />
      </div>
      <div className="toolbar">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Tìm người dùng</span>
          <input
            value={users.search}
            onChange={(event) => users.setSearch(event.target.value)}
            placeholder="Tìm nickname, email hoặc ID"
          />
          {users.search ? (
            <button
              className="clear-search"
              type="button"
              onClick={() => users.setSearch("")}
              aria-label="Xóa tìm kiếm"
            >
              <X size={15} />
            </button>
          ) : null}
        </label>
        <label className="sort-field">
          <span>Sắp xếp</span>
          <select
            value={users.sort}
            onChange={(event) => users.setSort(event.target.value)}
          >
            <option value="created_desc">Mới nhất</option>
            <option value="login_desc">Hoạt động gần nhất</option>
            <option value="nickname_asc">Tên A–Z</option>
            <option value="created_asc">Cũ nhất</option>
          </select>
        </label>
      </div>
      <div className="content-panel users-panel">
        {users.loading && users.users.length === 0 ? (
          <LoadingState />
        ) : users.users.length === 0 ? (
          <EmptyUsers hasSearch={Boolean(users.search)} />
        ) : (
          <div className="user-list">
            {users.users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                copied={users.copiedId === user.id}
                revoking={users.revokingId === user.id}
                onCopy={() => void users.copyText(user.id)}
                onDetail={() => void users.openUserDetail(user.id)}
                onEdit={() => users.openEdit(user)}
                onDelete={() => users.setUserToDelete(user)}
                onRevoke={() =>
                  void users.revokeSessions(user.id, user.nickname)
                }
              />
            ))}
          </div>
        )}
        <Pagination
          pagination={users.pagination}
          label="người dùng"
          busy={users.loading}
          onPageChange={users.setPage}
          onLimitChange={users.setLimit}
        />
      </div>
      {users.selectedUserId ? <UserDetailModal state={users} /> : null}
      {users.userToEdit ? <EditUserModal state={users} /> : null}
      {users.userToDelete ? <DeleteUserModal state={users} /> : null}
    </section>
  );
}

function UserMetric({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <div className={`metric-card user-metric tone-${tone}`}>
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function UserRow({
  user,
  copied,
  revoking,
  onCopy,
  onDetail,
  onEdit,
  onDelete,
  onRevoke,
}: {
  user: AdminUserItem;
  copied: boolean;
  revoking: boolean;
  onCopy: () => void;
  onDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRevoke: () => void;
}) {
  return (
    <article className="user-row">
      <div className="user-identity">
        <span
          className="avatar"
          style={{ background: avatarColor(user.profile?.colorA) }}
        >
          {user.nickname.slice(0, 1).toUpperCase() || "U"}
        </span>
        <div className="user-copy">
          <div className="user-name-line">
            <strong>{user.nickname}</strong>
            {user.email ? (
              <span className="person-chip">
                <Mail size={12} />
                {user.email}
              </span>
            ) : (
              <span className="muted-label">Chưa có email</span>
            )}
          </div>
          <div className="user-id">
            <code>{user.id}</code>
            <button
              type="button"
              onClick={onCopy}
              title="Sao chép User ID"
              aria-label="Sao chép User ID"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        </div>
      </div>
      <div className="user-facts">
        <span>
          Lần cuối hoạt động{" "}
          <strong>{formatDateTime(user.last_logged_in)}</strong>
        </span>
        <span>
          Tham gia{" "}
          <strong>
            {new Date(user.created_at).toLocaleDateString("vi-VN")}
          </strong>
        </span>
        <div className="count-chips">
          <span title="Bookmarks">
            <Bookmark size={13} />
            {user.counts.bookmarks}
          </span>
          <span title="Đã xem">
            <Film size={13} />
            {user.counts.watchHistory}
          </span>
          <span title="Addons">
            <Puzzle size={13} />
            {user.counts.addons}
          </span>
          <span title="Thiết bị">
            <Smartphone size={13} />
            {user.counts.sessions}
          </span>
        </div>
      </div>
      <div className="row-actions">
        <button
          className="button button-secondary"
          type="button"
          onClick={onDetail}
        >
          <Eye size={15} /> Chi tiết
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={onEdit}
          title="Chỉnh sửa"
        >
          <Edit2 size={15} />
        </button>
        {user.counts.sessions > 0 ? (
          <button
            className="icon-button warning"
            type="button"
            onClick={onRevoke}
            disabled={revoking}
            title="Đăng xuất thiết bị"
          >
            {revoking ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <LogOut size={15} />
            )}
          </button>
        ) : null}
        <button
          className="icon-button danger"
          type="button"
          onClick={onDelete}
          title="Xóa"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  );
}

function UserDetailModal({
  state,
}: {
  state: ReturnType<typeof useUserManagement>;
}) {
  const detail = state.userDetail;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) =>
        event.currentTarget === event.target && state.closeDetail()
      }
    >
      <section
        className="modal-panel user-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-detail-title"
      >
        <div className="modal-header">
          <div className="user-identity">
            {detail ? (
              <span
                className="avatar avatar-large"
                style={{ background: avatarColor(detail.user.profile?.colorA) }}
              >
                {detail.user.nickname.slice(0, 1).toUpperCase()}
              </span>
            ) : (
              <span className="avatar avatar-large">
                <Users size={20} />
              </span>
            )}
            <div>
              <p className="eyebrow">User detail</p>
              <h2 id="user-detail-title">
                {detail?.user.nickname || "Đang tải…"}
              </h2>
              <p className="modal-subtitle">
                {detail?.user.email || "Chưa liên kết email"}
              </p>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={state.closeDetail}
            title="Đóng"
          >
            <X size={17} />
          </button>
        </div>
        {state.detailLoading || !detail ? (
          <LoadingState label="Đang tải thông tin chi tiết" />
        ) : (
          <>
            <div className="detail-metrics">
              {(
                [
                  [Bookmark, "Bookmarks", detail.counts.bookmarks],
                  [Film, "Đã xem", detail.counts.watchHistory],
                  [Clock, "Tiến độ", detail.counts.progress],
                  [Puzzle, "Addons", detail.counts.addons],
                  [Smartphone, "Thiết bị", detail.counts.sessions],
                ] as const
              ).map(([Icon, label, value]) => (
                <div key={label}>
                  <Icon size={14} />
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="detail-tabs" role="tablist">
              {(
                [
                  ["overview", Sliders, "Tài khoản"],
                  ["addons", Puzzle, `Addons (${detail.counts.addons})`],
                  ["sessions", Smartphone, `Phiên (${detail.counts.sessions})`],
                ] as const
              ).map(([tab, Icon, label]) => (
                <button
                  key={tab}
                  className={state.detailTab === tab ? "is-active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={state.detailTab === tab}
                  onClick={() => state.setDetailTab(tab)}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
            {state.detailTab === "overview" ? (
              <Overview detail={detail} onCopy={state.copyText} />
            ) : state.detailTab === "addons" ? (
              <AddonList
                addons={detail.settings?.addons || []}
                onCopy={state.copyText}
              />
            ) : (
              <SessionList
                detail={detail}
                onRevoke={() =>
                  void state.revokeSessions(
                    detail.user.id,
                    detail.user.nickname,
                  )
                }
                revoking={state.revokingId === detail.user.id}
              />
            )}
          </>
        )}
        <div className="modal-footer">
          <button
            className="button button-secondary"
            type="button"
            onClick={state.closeDetail}
          >
            Đóng
          </button>
        </div>
      </section>
    </div>
  );
}

function Overview({
  detail,
  onCopy,
}: {
  detail: NonNullable<ReturnType<typeof useUserManagement>["userDetail"]>;
  onCopy: (text: string, label?: string) => Promise<void>;
}) {
  const settings = detail.settings;
  return (
    <div className="detail-stack">
      <div className="detail-block">
        <h3>Thông tin tài khoản</h3>
        <dl className="detail-grid">
          <Info label="User ID">
            <code>{detail.user.id}</code>
            <button
              className="text-button"
              type="button"
              onClick={() => void onCopy(detail.user.id)}
            >
              <Copy size={12} />
            </button>
          </Info>
          <Info label="Namespace">{detail.user.namespace || "—"}</Info>
          <Info label="Ngày tạo">{formatDateTime(detail.user.created_at)}</Info>
          <Info label="Lần cuối hoạt động">
            {formatDateTime(detail.user.last_logged_in)}
          </Info>
        </dl>
      </div>
      <div className="detail-block">
        <h3>Tùy chọn & cấu hình</h3>
        <dl className="detail-grid">
          <Info label="Giao diện">
            {settings?.applicationTheme || "ember (mặc định)"}
          </Info>
          <Info label="Ngôn ngữ">{settings?.applicationLanguage || "en"}</Info>
          <Info label="Phụ đề">
            {settings?.defaultSubtitleLanguage || "Không chọn"}
          </Info>
          <Info label="Tự động phát">
            {settings?.enableAutoplay ? "Bật" : "Tắt"}
          </Info>
          <Info label="Bỏ qua credits">
            {settings?.enableSkipCredits ? "Bật" : "Tắt"}
          </Info>
        </dl>
      </div>
    </div>
  );
}
function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
function AddonList({
  addons,
  onCopy,
}: {
  addons: UserInstalledAddon[];
  onCopy: (text: string, label?: string) => Promise<void>;
}) {
  if (!addons.length)
    return (
      <EmptyState
        title="Chưa cài addon"
        detail="Addon được đồng bộ khi người dùng cài trên client."
      />
    );
  return (
    <div className="detail-list">
      {addons.map((addon, index) => {
        const manifest = addon.manifest || {};
        const resources = Array.isArray(manifest.resources)
          ? manifest.resources.map((resource) =>
              typeof resource === "string"
                ? resource
                : String((resource as { name?: string }).name || ""),
            )
          : [];
        return (
          <article className="addon-row" key={`${addon.manifestUrl}-${index}`}>
            {manifest.logo ? (
              <img src={manifest.logo} alt={manifest.name || "Addon"} />
            ) : (
              <span className="addon-icon">
                <Puzzle size={17} />
              </span>
            )}
            <div>
              <div className="addon-title">
                <strong>{manifest.name || "Addon không tên"}</strong>
                {manifest.version ? (
                  <span className="status-badge">v{manifest.version}</span>
                ) : null}
                <span
                  className={`status-badge ${addon.enabled === false ? "status-muted" : "status-resolved"}`}
                >
                  {addon.enabled === false ? "Đã tắt" : "Đang bật"}
                </span>
              </div>
              {manifest.description ? <p>{manifest.description}</p> : null}
              <div className="addon-url">
                <code>{addon.manifestUrl}</code>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void onCopy(addon.manifestUrl, "Manifest URL")}
                >
                  <Copy size={12} />
                </button>
              </div>
              {resources.length ? (
                <div className="resource-tags">
                  {resources.map((resource) => (
                    <span key={resource}>{resource}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
function SessionList({
  detail,
  onRevoke,
  revoking,
}: {
  detail: NonNullable<ReturnType<typeof useUserManagement>["userDetail"]>;
  onRevoke: () => void;
  revoking: boolean;
}) {
  return (
    <div className="detail-list">
      {detail.sessions.length ? (
        <div className="detail-list-heading">
          <span>{detail.sessions.length} thiết bị đang đăng nhập</span>
          <button
            className="button button-danger"
            type="button"
            onClick={onRevoke}
            disabled={revoking}
          >
            <LogOut size={14} /> Đăng xuất tất cả
          </button>
        </div>
      ) : null}
      {detail.sessions.length ? (
        detail.sessions.map((session: UserSessionItem) => (
          <article className="session-row" key={session.id}>
            <div>
              <strong>
                <Smartphone size={14} /> {session.device || "Framezoo Client"}
              </strong>
              <code>{session.user_agent}</code>
            </div>
            <span>
              Hết hạn {new Date(session.expires_at).toLocaleDateString("vi-VN")}
            </span>
            <small>
              Tạo {formatDateTime(session.created_at)} · Truy cập{" "}
              {formatDateTime(session.accessed_at)}
            </small>
          </article>
        ))
      ) : (
        <EmptyState
          title="Không có phiên hoạt động"
          detail="Người dùng hiện không đăng nhập trên thiết bị nào."
        />
      )}
    </div>
  );
}

function EditUserModal({
  state,
}: {
  state: ReturnType<typeof useUserManagement>;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal-panel compact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-user-title"
      >
        <div className="modal-header">
          <h2 id="edit-user-title">
            <Edit2 size={17} /> Chỉnh sửa người dùng
          </h2>
          <button
            className="icon-button"
            type="button"
            onClick={() => state.setUserToEdit(null)}
            title="Đóng"
          >
            <X size={17} />
          </button>
        </div>
        <form className="form-stack" onSubmit={state.saveEdit}>
          <label>
            Nickname
            <input
              required
              maxLength={50}
              value={state.editNickname}
              onChange={(event) => state.setEditNickname(event.target.value)}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={state.editEmail}
              onChange={(event) => state.setEditEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <div className="modal-footer">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => state.setUserToEdit(null)}
              disabled={state.editLoading}
            >
              Hủy
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={state.editLoading || !state.editNickname.trim()}
            >
              {state.editLoading ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Check size={15} />
              )}{" "}
              Lưu
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function DeleteUserModal({
  state,
}: {
  state: ReturnType<typeof useUserManagement>;
}) {
  const user = state.userToDelete!;
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal-panel compact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-user-title"
      >
        <div className="modal-header">
          <div className="danger-heading">
            <AlertTriangle size={19} />
            <div>
              <h2 id="delete-user-title">Xóa tài khoản?</h2>
              <p>Hành động này không thể hoàn tác.</p>
            </div>
          </div>
        </div>
        <p className="delete-copy">
          Xóa <strong>{user.nickname}</strong> cùng bookmarks (
          {user.counts.bookmarks}), lịch sử xem ({user.counts.watchHistory}),
          addon và phiên đăng nhập.
        </p>
        <div className="modal-footer">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => state.setUserToDelete(null)}
            disabled={state.deleteLoading}
          >
            Hủy
          </button>
          <button
            className="button button-danger"
            type="button"
            onClick={() => void state.confirmDelete()}
            disabled={state.deleteLoading}
          >
            {state.deleteLoading ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Trash2 size={15} />
            )}{" "}
            Xóa vĩnh viễn
          </button>
        </div>
      </section>
    </div>
  );
}

function avatarColor(value: unknown) {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
    ? value
    : "var(--color-accent)";
}
function formatDateTime(value: string | null) {
  if (!value) return "Chưa hoạt động";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Chưa hoạt động"
    : date.toLocaleString("vi-VN");
}
function LoadingState({
  label = "Đang tải danh sách người dùng…",
}: {
  label?: string;
}) {
  return (
    <div className="empty-state">
      <Loader2 size={25} className="spin" />
      <p>{label}</p>
    </div>
  );
}
function EmptyUsers({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="empty-state">
      <UserRound size={28} />
      <strong>
        {hasSearch
          ? "Không tìm thấy người dùng phù hợp"
          : "Chưa có người dùng nào"}
      </strong>
      <p>
        {hasSearch
          ? "Thử đổi từ khóa tìm kiếm."
          : "Danh sách sẽ xuất hiện khi có tài khoản."}
      </p>
    </div>
  );
}
function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <Puzzle size={25} />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
