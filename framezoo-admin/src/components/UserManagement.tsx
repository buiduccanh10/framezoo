import {
  Check,
  Clock,
  Copy,
  Edit2,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  Mail,
  RotateCcw,
  Search,
  Sliders,
  Smartphone,
  Tag,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { Pagination } from "./Pagination";
import { useUserManagement } from "../hooks/useUserManagement";
import type { adminApi } from "../lib/api";
import type { AdminUserItem, UserSessionItem } from "../types";

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
          <h1 id="users-heading">Người dùng</h1>
          <p className="section-lede">
            Quản lý tài khoản, phiên bản ứng dụng đang dùng và phiên đăng nhập.
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
          )}
          Làm mới
        </button>
      </div>

      <div className="metric-grid metric-grid-four">
        <UserMetric
          label="Tổng người dùng"
          value={users.stats.totalUsers}
          icon={<Users size={16} />}
          tone="blue"
        />
        <UserMetric
          label="Hoạt động 30 ngày"
          value={users.stats.activeRecently}
          icon={<Clock size={16} />}
          tone="green"
        />
        <UserMetric
          label="Có email"
          value={users.stats.usersWithEmail}
          icon={<Mail size={16} />}
          tone="amber"
        />
        <UserMetric
          label="Phiên hoạt động"
          value={users.stats.totalSessions}
          icon={<Smartphone size={16} />}
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
            placeholder="Tìm nickname, email hoặc ID…"
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
            <option value="version_desc">Phiên bản cao → thấp</option>
            <option value="version_asc">Phiên bản thấp → cao</option>
            <option value="nickname_asc">Tên A–Z</option>
            <option value="created_asc">Cũ nhất</option>
          </select>
        </label>
      </div>

      <div className="content-panel">
        {users.loading && users.users.length === 0 ? (
          <LoadingState />
        ) : users.users.length === 0 ? (
          <EmptyUsers hasSearch={Boolean(users.search)} />
        ) : (
          <div className="table-wrap">
            <table className="data-table users-table">
              <thead>
                <tr>
                  <th>Người dùng</th>
                  <th>Phiên bản</th>
                  <th>Phiên</th>
                  <th>Hoạt động cuối</th>
                  <th>Ngày tạo</th>
                  <th className="col-actions">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {users.users.map((user) => (
                  <UserTableRow
                    key={user.id}
                    user={user}
                    copied={users.copiedId === user.id}
                    revoking={users.revokingId === user.id}
                    onCopy={() => void users.copyText(user.id)}
                    onDetail={() => void users.openUserDetail(user.id)}
                    onEdit={() => users.openEdit(user)}
                    onDelete={() => users.setUserToDelete(user)}
                    onRevoke={() =>
                      users.setUserToRevoke({
                        id: user.id,
                        nickname: user.nickname,
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
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

      {users.selectedUserId ? (
        <UserDetailModal key={users.selectedUserId} state={users} />
      ) : null}
      {users.userToEdit ? <EditUserModal state={users} /> : null}

      <ConfirmModal
        open={Boolean(users.userToDelete)}
        title="Xóa tài khoản?"
        description={
          users.userToDelete
            ? `Xóa vĩnh viễn tài khoản “${users.userToDelete.nickname}” cùng toàn bộ dữ liệu liên quan và ${users.userToDelete.counts.sessions} phiên đăng nhập.`
            : ""
        }
        confirmLabel="Xóa vĩnh viễn"
        tone="danger"
        busy={users.deleteLoading}
        onConfirm={() => void users.confirmDelete()}
        onCancel={() => users.setUserToDelete(null)}
      />

      <ConfirmModal
        open={Boolean(users.userToRevoke)}
        title="Đăng xuất tất cả thiết bị?"
        description={
          users.userToRevoke
            ? `Thu hồi toàn bộ phiên đăng nhập hiện tại của “${users.userToRevoke.nickname}”.`
            : ""
        }
        confirmLabel="Đăng xuất thiết bị"
        tone="warning"
        busy={Boolean(users.revokingId)}
        onConfirm={() => void users.confirmRevokeSessions()}
        onCancel={() => users.setUserToRevoke(null)}
      />
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
    <div className={`metric-card tone-${tone}`}>
      <span className="metric-label">
        {icon}
        {label}
      </span>
      <strong>{value.toLocaleString("vi-VN")}</strong>
    </div>
  );
}

function UserTableRow({
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
    <tr>
      <td data-label="Người dùng">
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
                <span className="masked-email" title="Email được ẩn một phần">
                  {maskEmail(user.email)}
                </span>
              ) : (
                <span className="muted-label">Chưa có email</span>
              )}
            </div>
            <div className="user-id">
              <code>{shortId(user.id)}</code>
              <button
                type="button"
                onClick={onCopy}
                title="Sao chép User ID"
                aria-label="Sao chép User ID"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </div>
        </div>
      </td>
      <td data-label="Phiên bản">
        <VersionBadge version={user.app_version} />
      </td>
      <td data-label="Phiên">
        <span className="count-pill">
          <Smartphone size={13} aria-hidden="true" />
          {user.counts.sessions}
        </span>
      </td>
      <td data-label="Hoạt động cuối" className="cell-date">
        {formatDateTime(user.last_logged_in)}
      </td>
      <td data-label="Ngày tạo" className="cell-date">
        {new Date(user.created_at).toLocaleDateString("vi-VN")}
      </td>
      <td data-label="Thao tác" className="col-actions">
        <div className="row-actions">
          <button
            className="button button-secondary button-sm"
            type="button"
            onClick={onDetail}
          >
            <Eye size={14} /> Chi tiết
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={onEdit}
            title="Chỉnh sửa"
            aria-label={`Chỉnh sửa ${user.nickname}`}
          >
            <Edit2 size={14} />
          </button>
          {user.counts.sessions > 0 ? (
            <button
              className="icon-button warning"
              type="button"
              onClick={onRevoke}
              disabled={revoking}
              title="Đăng xuất thiết bị"
              aria-label={`Đăng xuất thiết bị của ${user.nickname}`}
            >
              {revoking ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <LogOut size={14} />
              )}
            </button>
          ) : null}
          <button
            className="icon-button danger"
            type="button"
            onClick={onDelete}
            title="Xóa tài khoản"
            aria-label={`Xóa ${user.nickname}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function UserDetailModal({
  state,
}: {
  state: ReturnType<typeof useUserManagement>;
}) {
  const detail = state.userDetail;
  const [revealEmail, setRevealEmail] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !state.userToEdit &&
        !state.userToDelete &&
        !state.userToRevoke
      ) {
        state.closeDetail();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state]);

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
              <p className="eyebrow">Hồ sơ tài khoản</p>
              <h2 id="user-detail-title">
                {detail?.user.nickname || "Đang tải…"}
              </h2>
              <div className="modal-subtitle-row">
                <span className="modal-subtitle">
                  {detail?.user.email
                    ? revealEmail
                      ? detail.user.email
                      : maskEmail(detail.user.email)
                    : "Chưa liên kết email"}
                </span>
                {detail?.user.email ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setRevealEmail((prev) => !prev)}
                    aria-label={revealEmail ? "Ẩn email" : "Hiện email"}
                    title={revealEmail ? "Ẩn email" : "Hiện email"}
                  >
                    {revealEmail ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={state.closeDetail}
            aria-label="Đóng"
          >
            <X size={17} />
          </button>
        </div>

        {state.detailLoading || !detail ? (
          <LoadingState label="Đang tải thông tin chi tiết…" />
        ) : (
          <>
            <div className="detail-summary-strip">
              <div>
                <span>Phiên bản hiện tại</span>
                <VersionBadge version={detail.user.app_version} />
              </div>
              <div>
                <span>Phiên hoạt động</span>
                <strong>{detail.counts.sessions}</strong>
              </div>
              <div>
                <span>Hoạt động cuối</span>
                <strong>{formatDateTime(detail.user.last_logged_in)}</strong>
              </div>
            </div>

            <div className="detail-tabs" role="tablist">
              {(
                [
                  ["overview", Sliders, "Tài khoản"],
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
            ) : (
              <SessionList
                detail={detail}
                onRevoke={() =>
                  state.setUserToRevoke({
                    id: detail.user.id,
                    nickname: detail.user.nickname,
                  })
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
              aria-label="Sao chép User ID"
            >
              <Copy size={12} />
            </button>
          </Info>
          <Info label="Phiên bản ứng dụng">
            <VersionBadge version={detail.user.app_version} />
          </Info>
          <Info label="Namespace">{detail.user.namespace || "—"}</Info>
          <Info label="Ngày tạo">{formatDateTime(detail.user.created_at)}</Info>
        </dl>
      </div>
      <div className="detail-block">
        <h3>Tùy chọn giao diện</h3>
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
            className="button button-danger button-sm"
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
            <div className="session-main">
              <strong>
                <Smartphone size={14} /> {session.device || "Framezoo Client"}
              </strong>
              <div className="session-tags">
                <span className="platform-chip">{session.platform}</span>
                {session.app_version ? (
                  <VersionBadge version={session.app_version} />
                ) : null}
              </div>
            </div>
            <div className="session-meta">
              <span>
                Hết hạn{" "}
                {new Date(session.expires_at).toLocaleDateString("vi-VN")}
              </span>
              <small>
                Tạo {formatDateTime(session.created_at)} · Truy cập{" "}
                {formatDateTime(session.accessed_at)}
              </small>
            </div>
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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !state.editLoading) {
        state.setUserToEdit(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !state.editLoading) {
          state.setUserToEdit(null);
        }
      }}
    >
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
            disabled={state.editLoading}
            aria-label="Đóng"
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
              )}
              Lưu
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function VersionBadge({ version }: { version: string | null }) {
  if (!version) {
    return <span className="version-badge is-unknown">Chưa rõ</span>;
  }
  const label = version.startsWith("v") ? version : `v${version}`;
  return (
    <span className="version-badge">
      <Tag size={11} aria-hidden="true" />
      {label}
    </span>
  );
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

function shortId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
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
      <Loader2 size={24} className="spin" />
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
      <Smartphone size={24} />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
