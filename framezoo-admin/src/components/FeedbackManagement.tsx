import {
  Check,
  Eye,
  Image,
  Loader2,
  MessageSquare,
  RotateCcw,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useEffect } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { Pagination } from "./Pagination";
import { useFeedbackManagement } from "../hooks/useFeedbackManagement";

interface FeedbackManagementProps {
  onMessage: (message: string) => void;
  onPendingChange: (count: number) => void;
}

export function FeedbackManagement({
  onMessage,
  onPendingChange,
}: FeedbackManagementProps) {
  const feedback = useFeedbackManagement(onMessage, onPendingChange);

  useEffect(() => {
    if (!feedback.selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") feedback.setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [feedback]);

  return (
    <section className="workspace-section" aria-labelledby="feedback-heading">
      <div className="section-heading">
        <div>
          <h1 id="feedback-heading">Phản hồi người dùng</h1>
          <p className="section-lede">
            Hàng đợi hỗ trợ có trạng thái, tìm kiếm và xử lý theo trang.
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void feedback.load()}
          disabled={feedback.loading}
        >
          {feedback.loading ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <RotateCcw size={16} />
          )}
          Làm mới
        </button>
      </div>

      <div className="metric-grid metric-grid-three">
        <Metric label="Tổng phản hồi" value={feedback.stats.total} tone="blue" />
        <Metric
          label="Đang xử lý"
          value={feedback.stats.pending}
          tone="amber"
        />
        <Metric label="Đã xử lý" value={feedback.stats.resolved} tone="green" />
      </div>

      <div className="toolbar">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Tìm feedback</span>
          <input
            value={feedback.search}
            onChange={(event) => feedback.setSearch(event.target.value)}
            placeholder="Tìm tiêu đề, nội dung, người dùng…"
          />
          {feedback.search ? (
            <button
              className="clear-search"
              type="button"
              onClick={() => feedback.setSearch("")}
              aria-label="Xóa tìm kiếm"
            >
              <X size={15} />
            </button>
          ) : null}
        </label>
        <div className="segmented" role="group" aria-label="Lọc feedback">
          {(["all", "pending", "resolved"] as const).map((value) => (
            <button
              key={value}
              className={feedback.filter === value ? "is-active" : ""}
              type="button"
              onClick={() => feedback.setFilter(value)}
            >
              {value === "all"
                ? "Tất cả"
                : value === "pending"
                  ? "Đang xử lý"
                  : "Đã xử lý"}
            </button>
          ))}
        </div>
      </div>

      <div className="content-panel">
        {feedback.error ? (
          <p className="inline-error" role="alert">
            {feedback.error}
          </p>
        ) : null}
        {feedback.loading && feedback.items.length === 0 ? (
          <LoadingState label="Đang tải feedback…" />
        ) : feedback.items.length === 0 ? (
          <EmptyState
            title="Không có feedback phù hợp"
            detail="Thử đổi bộ lọc hoặc từ khóa."
          />
        ) : (
          <div className="feedback-list">
            {feedback.items.map((item) => {
              const pending = item.status === "pending";
              const busy = feedback.busyId === item.id;
              return (
                <article key={item.id} className="feedback-row">
                  <div className="feedback-main">
                    <div className="feedback-title-row">
                      <h2>{item.title}</h2>
                      <StatusBadge pending={pending} />
                      <span className="person-chip">
                        <User size={12} aria-hidden="true" />{" "}
                        {item.user?.nickname || "Khách"}
                      </span>
                      {item.attachments.length > 0 ? (
                        <span className="person-chip">
                          <Image size={12} aria-hidden="true" />{" "}
                          {item.attachments.length} tệp
                        </span>
                      ) : null}
                    </div>
                    <p className="feedback-excerpt">{item.description}</p>
                    <time dateTime={item.created_at}>
                      {new Date(item.created_at).toLocaleString("vi-VN")}
                    </time>
                  </div>
                  <div className="row-actions">
                    <button
                      className="button button-secondary button-sm"
                      type="button"
                      onClick={() => feedback.setSelected(item)}
                    >
                      <Eye size={14} /> Chi tiết
                    </button>
                    <button
                      className={`button button-sm ${pending ? "button-primary" : "button-secondary"}`}
                      type="button"
                      onClick={() => void feedback.updateStatus(item)}
                      disabled={busy}
                    >
                      {busy ? (
                        <Loader2 size={14} className="spin" />
                      ) : pending ? (
                        <Check size={14} />
                      ) : (
                        <RotateCcw size={14} />
                      )}
                      {pending ? "Hoàn tất" : "Mở lại"}
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      onClick={() => feedback.setItemToDelete(item)}
                      disabled={busy}
                      title="Xóa feedback và tệp đính kèm"
                      aria-label={`Xóa feedback ${item.title}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <Pagination
          pagination={feedback.pagination}
          label="feedback"
          busy={feedback.loading}
          onPageChange={feedback.setPage}
          onLimitChange={feedback.setLimit}
        />
      </div>

      {feedback.selected ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) =>
            event.currentTarget === event.target && feedback.setSelected(null)
          }
        >
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-detail-title"
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Chi tiết phản hồi</p>
                <h2 id="feedback-detail-title">{feedback.selected.title}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => feedback.setSelected(null)}
                aria-label="Đóng"
              >
                <X size={17} />
              </button>
            </div>
            <div className="feedback-detail-meta">
              <StatusBadge pending={feedback.selected.status === "pending"} />
              <span className="person-chip">
                <User size={12} /> {feedback.selected.user?.nickname || "Khách"}
              </span>
              <time dateTime={feedback.selected.created_at}>
                {new Date(feedback.selected.created_at).toLocaleString("vi-VN")}
              </time>
            </div>
            <div className="detail-copy">{feedback.selected.description}</div>
            {feedback.selected.attachments.length > 0 ? (
              <div className="feedback-attachments">
                <h3>Tệp đính kèm</h3>
                <div className="feedback-attachment-grid">
                  {feedback.selected.attachments.map((attachment) => (
                    <a
                      key={attachment.key}
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={attachment.name}
                    >
                      {attachment.kind === "video" ? (
                        <video
                          src={attachment.url}
                          muted
                          controls
                          preload="metadata"
                          aria-label={attachment.name}
                          onClick={(event) => event.stopPropagation()}
                        />
                      ) : (
                        <img
                          src={attachment.url}
                          alt={attachment.name}
                          loading="lazy"
                        />
                      )}
                      <span>{attachment.name}</span>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="modal-footer">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => feedback.setSelected(null)}
              >
                Đóng
              </button>
              <button
                className="button button-danger"
                type="button"
                onClick={() => feedback.setItemToDelete(feedback.selected)}
              >
                <Trash2 size={15} /> Xóa
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={() => void feedback.updateStatus(feedback.selected!)}
                disabled={feedback.busyId === feedback.selected.id}
              >
                {feedback.selected.status === "pending" ? (
                  <>
                    <Check size={15} /> Đánh dấu đã xử lý
                  </>
                ) : (
                  <>
                    <RotateCcw size={15} /> Mở lại
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <ConfirmModal
        open={Boolean(feedback.itemToDelete)}
        title="Xóa phản hồi?"
        description={
          feedback.itemToDelete
            ? `Xóa phản hồi “${feedback.itemToDelete.title}” và toàn bộ tệp đính kèm.`
            : ""
        }
        confirmLabel="Xóa vĩnh viễn"
        tone="danger"
        busy={
          Boolean(feedback.itemToDelete) &&
          feedback.busyId === feedback.itemToDelete?.id
        }
        onConfirm={() => void feedback.confirmRemove()}
        onCancel={() => feedback.setItemToDelete(null)}
      />
    </section>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blue" | "amber" | "green";
}) {
  return (
    <div className={`metric-card tone-${tone}`}>
      <span className="metric-label">{label}</span>
      <strong>{value.toLocaleString("vi-VN")}</strong>
    </div>
  );
}

function StatusBadge({ pending }: { pending: boolean }) {
  return (
    <span
      className={`status-badge ${pending ? "status-pending" : "status-resolved"}`}
    >
      {pending ? (
        "Đang xử lý"
      ) : (
        <>
          <Check size={12} /> Đã xử lý
        </>
      )}
    </span>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="empty-state">
      <Loader2 size={24} className="spin" />
      <p>{label}</p>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <MessageSquare size={28} />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
