import { Check, CheckCircle2, Eye, Loader2, MessageSquare, RotateCcw, Search, Trash2, User, X } from "lucide-react";
import { Pagination } from "./Pagination";
import { useFeedbackManagement } from "../hooks/useFeedbackManagement";

interface FeedbackManagementProps {
  onMessage: (message: string) => void;
  onPendingChange: (count: number) => void;
}

export function FeedbackManagement({ onMessage, onPendingChange }: FeedbackManagementProps) {
  const feedback = useFeedbackManagement(onMessage, onPendingChange);

  return (
    <section className="workspace-section" aria-labelledby="feedback-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Support queue</p><h1 id="feedback-heading">Phản hồi người dùng</h1><p className="section-lede">Hàng đợi có trạng thái, tìm kiếm và xử lý theo trang.</p></div>
        <button className="button button-secondary" type="button" onClick={() => void feedback.load()} disabled={feedback.loading}>{feedback.loading ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />} Làm mới</button>
      </div>
      <div className="metric-grid metric-grid-three"><Metric label="Tổng phản hồi" value={feedback.stats.total} tone="blue" /><Metric label="Đang xử lý" value={feedback.stats.pending} tone="amber" /><Metric label="Đã xử lý" value={feedback.stats.resolved} tone="green" /></div>
      <div className="toolbar"><label className="search-field"><Search size={16} aria-hidden="true" /><span className="sr-only">Tìm feedback</span><input value={feedback.search} onChange={event => feedback.setSearch(event.target.value)} placeholder="Tìm tiêu đề, nội dung, người dùng" /></label><div className="segmented" role="group" aria-label="Lọc feedback">{(["all", "pending", "resolved"] as const).map(value => <button key={value} className={feedback.filter === value ? "is-active" : ""} type="button" onClick={() => feedback.setFilter(value)}>{value === "all" ? "Tất cả" : value === "pending" ? "Đang xử lý" : "Đã xử lý"}</button>)}</div></div>
      <div className="content-panel">
        {feedback.error ? <p className="inline-error" role="alert">{feedback.error}</p> : null}
        {feedback.loading && feedback.items.length === 0 ? <LoadingState label="Đang tải feedback" /> : feedback.items.length === 0 ? <EmptyState title="Không có feedback phù hợp" detail="Thử đổi bộ lọc hoặc từ khóa." /> : <div className="feedback-list">{feedback.items.map(item => { const pending = item.status === "pending"; const busy = feedback.busyId === item.id; return <article key={item.id} className="feedback-row"><div className="feedback-main"><div className="feedback-title-row"><h2>{item.title}</h2><StatusBadge pending={pending} /><span className="person-chip"><User size={13} /> {item.user?.nickname || "Khách"}</span></div><p>{item.description}</p><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("vi-VN")}</time></div><div className="row-actions"><button className="icon-button" type="button" onClick={() => feedback.setSelected(item)} title="Xem chi tiết"><Eye size={16} /></button><button className={`button ${pending ? "button-success" : "button-secondary"}`} type="button" onClick={() => void feedback.updateStatus(item)} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : pending ? <CheckCircle2 size={15} /> : <RotateCcw size={15} />}{pending ? "Đã xử lý" : "Mở lại"}</button><button className="icon-button danger" type="button" onClick={() => void feedback.remove(item)} disabled={busy} title="Xóa feedback"><Trash2 size={16} /></button></div></article>; })}</div>}
        <Pagination pagination={feedback.pagination} label="feedback" busy={feedback.loading} onPageChange={feedback.setPage} />
      </div>
      {feedback.selected ? <div className="modal-backdrop" role="presentation" onMouseDown={event => event.currentTarget === event.target && feedback.setSelected(null)}><section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="feedback-detail-title"><div className="modal-header"><div><p className="eyebrow">Feedback detail</p><h2 id="feedback-detail-title">{feedback.selected.title}</h2></div><button className="icon-button" type="button" onClick={() => feedback.setSelected(null)} title="Đóng"><X size={17} /></button></div><StatusBadge pending={feedback.selected.status === "pending"} /><div className="detail-copy">{feedback.selected.description}</div><div className="modal-footer"><button className="button button-secondary" type="button" onClick={() => feedback.setSelected(null)}>Đóng</button><button className="button button-primary" type="button" onClick={() => void feedback.updateStatus(feedback.selected!)}>{feedback.selected.status === "pending" ? <Check size={16} /> : <RotateCcw size={16} />}{feedback.selected.status === "pending" ? "Đã xử lý" : "Mở lại"}</button></div></section></div> : null}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "blue" | "amber" | "green" }) { return <div className={`metric-card tone-${tone}`}><span>{label}</span><strong>{value}</strong></div>; }
function StatusBadge({ pending }: { pending: boolean }) { return <span className={`status-badge ${pending ? "status-pending" : "status-resolved"}`}>{pending ? "Đang xử lý" : <><Check size={12} /> Đã xử lý</>}</span>; }
function LoadingState({ label }: { label: string }) { return <div className="empty-state"><Loader2 size={24} className="spin" /><p>{label}</p></div>; }
function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><MessageSquare size={28} /><strong>{title}</strong><p>{detail}</p></div>; }
