import { AlertTriangle, Loader2, X } from "lucide-react";
import { useEffect } from "react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "warning";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onCancel();
      }}
    >
      <section
        className="modal-panel compact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <div className="modal-header">
          <div className={`confirm-heading tone-${tone}`}>
            <span className="confirm-icon" aria-hidden="true">
              <AlertTriangle size={18} />
            </span>
            <div>
              <h2 id="confirm-modal-title">{title}</h2>
              <p>Hành động này không thể hoàn tác.</p>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Đóng"
          >
            <X size={16} />
          </button>
        </div>

        <p className="confirm-copy">{description}</p>

        <div className="modal-footer">
          <button
            className="button button-secondary"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            Hủy
          </button>
          <button
            className={`button ${tone === "danger" ? "button-danger" : "button-primary"}`}
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 size={15} className="spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
