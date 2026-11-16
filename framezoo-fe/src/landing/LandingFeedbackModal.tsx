import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { getConfiguredBackendUrl } from "@/backend/download";

import type { LandingCopy } from "./i18n";
import { MessageSquareIcon } from "./LandingIcon";

const MAX_FEEDBACK_FILE_BYTES = 55 * 1024 * 1024;
const EMAIL_CONTACT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_CONTACT_REGEX = /^\+?\d{7,15}$/;

function isValidContact(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 255) return false;
  if (EMAIL_CONTACT_REGEX.test(trimmed)) return true;
  return PHONE_CONTACT_REGEX.test(trimmed.replace(/[\s().-]/g, ""));
}

export type LandingFeedbackCategory =
  "bug" | "feature" | "copyright" | "privacy" | "other";

interface LandingFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  copy?: LandingCopy["feedback"];
  initialCategory?: LandingFeedbackCategory;
}

const defaultFeedbackCopy: LandingCopy["feedback"] = {
  button: "Phản hồi",
  badge: "Đóng góp ý kiến",
  modalTitle: "Gửi phản hồi cho chúng tôi",
  subtitle:
    "Hãy cho chúng tôi biết vấn đề hoặc khó khăn bạn gặp phải trong quá trình trải nghiệm Framezoo.",
  titleLabel: "1. Tiêu đề vấn đề",
  titlePlaceholder: "Ví dụ: Lỗi tải phụ đề phim, Giật lag khi phát...",
  contactLabel: "2. Email hoặc Số điện thoại",
  contactPlaceholder: "Ví dụ: name@example.com hoặc 0912345678",
  contactInvalid:
    "Vui lòng nhập email hoặc số điện thoại hợp lệ để chúng tôi phản hồi.",
  descLabel: "3. Mô tả chi tiết vấn đề",
  descPlaceholder: "Mô tả cụ thể vấn đề hoặc các bước dẫn tới lỗi...",
  errorRequired:
    "Vui lòng nhập đầy đủ tiêu đề, thông tin liên hệ và nội dung mô tả vấn đề.",
  errorSubmit:
    "Có lỗi xảy ra trong quá trình gửi phản hồi. Vui lòng thử lại sau.",
  successTitle: "Gửi phản hồi thành công!",
  successDesc:
    "Cảm ơn bạn đã đóng góp ý kiến. Đội ngũ phát triển sẽ kiểm tra và xử lý vấn đề sớm nhất.",
  cancel: "Hủy",
  submit: "Gửi phản hồi",
  submitting: "Đang gửi...",
  close: "Đóng",
  attachmentsLabel: "Files đính kèm",
  attachmentsHint: "Ảnh/video · tổng tối đa 55 MB",
  attachmentsTooLarge: "Tổng dung lượng files không được vượt quá 55 MB.",
};

export function LandingFeedbackModal({
  isOpen,
  onClose,
  copy = defaultFeedbackCopy,
  initialCategory = "bug",
}: LandingFeedbackModalProps) {
  const [category, setCategory] =
    useState<LandingFeedbackCategory>(initialCategory);
  const [title, setTitle] = useState("");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");
  const [targetUrlOrId, setTargetUrlOrId] = useState("");
  const [rightsOwnerName, setRightsOwnerName] = useState("");
  const [swornStatement, setSwornStatement] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fbCopy = copy ?? defaultFeedbackCopy;

  useEffect(() => {
    if (!isOpen) {
      setCategory(initialCategory);
      setTitle("");
      setContact("");
      setDescription("");
      setTargetUrlOrId("");
      setRightsOwnerName("");
      setSwornStatement(false);
      setAttachments([]);
      setError(null);
      setSuccess(false);
      setLoading(false);
      return;
    }

    setCategory(initialCategory);

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [initialCategory, isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !contact.trim() || !description.trim()) {
      setError(fbCopy.errorRequired);
      return;
    }
    if (!isValidContact(contact)) {
      setError(fbCopy.contactInvalid);
      return;
    }
    if (category === "copyright") {
      if (!targetUrlOrId.trim() || !rightsOwnerName.trim()) {
        setError(
          "Vui lòng nhập đầy đủ URL/ID nội dung vi phạm và tên chủ thể quyền sở hữu trí tuệ.",
        );
        return;
      }
      if (!swornStatement) {
        setError(
          "Vui lòng đánh dấu cam kết thông tin khiếu nại bản quyền là trung thực.",
        );
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const backendUrl = getConfiguredBackendUrl();
      const endpoint = backendUrl
        ? `${backendUrl.replace(/\/+$/, "")}/api/feedback`
        : "/api/feedback";

      const headers: Record<string, string> = {};

      // Check if user has token in localStorage
      try {
        const storedToken =
          localStorage.getItem("fz_token") ||
          localStorage.getItem("token") ||
          localStorage.getItem("admin_token");
        if (storedToken) {
          headers.Authorization = `Bearer ${storedToken}`;
        }
      } catch {
        // Ignore localStorage error
      }

      const formData = new FormData();
      formData.append("category", category);
      formData.append("title", title.trim());
      formData.append("contact", contact.trim());
      formData.append("description", description.trim());
      if (category === "copyright") {
        formData.append("targetUrlOrId", targetUrlOrId.trim());
        formData.append("rightsOwnerName", rightsOwnerName.trim());
        formData.append("swornStatement", String(swornStatement));
      }
      attachments.forEach((file) => formData.append("files", file));

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        credentials: "include",
        body: formData,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.message || fbCopy.errorSubmit);
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 2200);
    } catch (err: any) {
      setError(err.message || fbCopy.errorSubmit);
    } finally {
      setLoading(false);
    }
  };

  const handleAttachments = (files: FileList | null) => {
    const next = Array.from(files ?? []);
    const total = next.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_FEEDBACK_FILE_BYTES) {
      setAttachments([]);
      setError(fbCopy.attachmentsTooLarge);
      return;
    }
    setError(null);
    setAttachments(next);
  };

  return createPortal(
    <div
      className="landing-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="landing-modal-card">
        <button
          type="button"
          className="landing-modal-close"
          onClick={onClose}
          aria-label={fbCopy.close}
        >
          ✕
        </button>

        {success ? (
          <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <div
              style={{
                width: "3.5rem",
                height: "3.5rem",
                borderRadius: "50%",
                background: "rgba(34, 197, 94, 0.15)",
                color: "#4ade80",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 1.25rem auto",
                fontSize: "1.75rem",
                border: "1px solid rgba(34, 197, 94, 0.3)",
              }}
            >
              ✓
            </div>
            <h3
              style={{
                fontSize: "1.25rem",
                fontWeight: 700,
                color: "var(--color-ink)",
                marginBottom: "0.5rem",
              }}
            >
              {fbCopy.successTitle}
            </h3>
            <p
              style={{
                fontSize: "0.875rem",
                color: "var(--landing-muted)",
                lineHeight: 1.6,
                maxWidth: "360px",
                margin: "0 auto 1.5rem auto",
              }}
            >
              {fbCopy.successDesc}
            </p>
            <button
              type="button"
              className="landing-button landing-button-quiet"
              onClick={onClose}
              style={{ margin: "0 auto" }}
            >
              {fbCopy.close}
            </button>
          </div>
        ) : (
          <div>
            <div
              className="landing-modal-header"
              style={{ marginBottom: "1.25rem" }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  color: "var(--landing-amber)",
                  marginBottom: "0.25rem",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                }}
              >
                <MessageSquareIcon />
                <span>{fbCopy.badge}</span>
              </div>
              <h3 id="feedback-modal-title" style={{ fontSize: "1.375rem" }}>
                {fbCopy.modalTitle}
              </h3>
              <p
                style={{
                  fontSize: "0.875rem",
                  color: "var(--landing-muted)",
                  marginTop: "0.25rem",
                  lineHeight: 1.5,
                }}
              >
                {fbCopy.subtitle}
              </p>
            </div>

            {error && (
              <div
                style={{
                  padding: "0.75rem 1rem",
                  borderRadius: "0.75rem",
                  background: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#fca5a5",
                  fontSize: "0.8125rem",
                  marginBottom: "1rem",
                }}
              >
                {error}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.375rem",
                }}
              >
                <label
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--landing-muted)",
                  }}
                >
                  Phân loại yêu cầu <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as LandingFeedbackCategory)
                  }
                  disabled={loading}
                  style={{
                    width: "100%",
                    padding: "0.625rem 0.875rem",
                    borderRadius: "0.625rem",
                    background: "rgba(20, 14, 14, 0.95)",
                    border: "1px solid var(--landing-line)",
                    color: "var(--color-ink)",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                >
                  <option value="bug">Báo lỗi kỹ thuật</option>
                  <option value="feature">Đề xuất tính năng</option>
                  <option value="copyright">
                    Khiếu nại Bản quyền / DMCA (SLA 24h–72h)
                  </option>
                  <option value="privacy">
                    Yêu cầu Dữ liệu cá nhân (Luật 91/2025)
                  </option>
                  <option value="other">Liên hệ khác</option>
                </select>
              </div>

              {category === "copyright" && (
                <>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.375rem",
                    }}
                  >
                    <label
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--landing-muted)",
                      }}
                    >
                      Chủ thể quyền / Đại diện hợp pháp{" "}
                      <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={rightsOwnerName}
                      onChange={(e) => setRightsOwnerName(e.target.value)}
                      placeholder="Họ tên / Tên tổ chức chủ sở hữu quyền..."
                      maxLength={255}
                      disabled={loading}
                      required
                      style={{
                        width: "100%",
                        padding: "0.625rem 0.875rem",
                        borderRadius: "0.625rem",
                        background: "rgba(255, 255, 255, 0.05)",
                        border: "1px solid var(--landing-line)",
                        color: "var(--color-ink)",
                        fontSize: "0.875rem",
                        outline: "none",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.375rem",
                    }}
                  >
                    <label
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--landing-muted)",
                      }}
                    >
                      URL Addon, ID Phụ đề hoặc ID Tác phẩm{" "}
                      <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={targetUrlOrId}
                      onChange={(e) => setTargetUrlOrId(e.target.value)}
                      placeholder="vd: bad-addon.example.com hoặc subsource:12345 hoặc tt0137523"
                      maxLength={500}
                      disabled={loading}
                      required
                      style={{
                        width: "100%",
                        padding: "0.625rem 0.875rem",
                        borderRadius: "0.625rem",
                        background: "rgba(255, 255, 255, 0.05)",
                        border: "1px solid var(--landing-line)",
                        color: "var(--color-ink)",
                        fontSize: "0.875rem",
                        outline: "none",
                      }}
                    />
                  </div>
                </>
              )}

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.375rem",
                }}
              >
                <label
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--landing-muted)",
                  }}
                >
                  {fbCopy.titleLabel}{" "}
                  <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={fbCopy.titlePlaceholder}
                  maxLength={255}
                  disabled={loading}
                  required
                  style={{
                    width: "100%",
                    padding: "0.625rem 0.875rem",
                    borderRadius: "0.625rem",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--landing-line)",
                    color: "var(--color-ink)",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.375rem",
                }}
              >
                <label
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--landing-muted)",
                  }}
                >
                  {fbCopy.contactLabel}{" "}
                  <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder={fbCopy.contactPlaceholder}
                  maxLength={255}
                  disabled={loading}
                  required
                  style={{
                    width: "100%",
                    padding: "0.625rem 0.875rem",
                    borderRadius: "0.625rem",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--landing-line)",
                    color: "var(--color-ink)",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.375rem",
                }}
              >
                <label
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--landing-muted)",
                  }}
                >
                  {fbCopy.attachmentsLabel}
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,application/pdf"
                  multiple
                  onChange={(event) => handleAttachments(event.target.files)}
                  disabled={loading}
                  style={{
                    width: "100%",
                    padding: "0.55rem 0.7rem",
                    borderRadius: "0.625rem",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--landing-line)",
                    color: "var(--color-ink)",
                    fontSize: "0.8125rem",
                  }}
                />
                <small
                  style={{ color: "var(--landing-muted)", fontSize: "0.75rem" }}
                >
                  {fbCopy.attachmentsHint}
                </small>
                {attachments.length > 0 && (
                  <small
                    style={{
                      color: "var(--landing-muted)",
                      fontSize: "0.75rem",
                    }}
                  >
                    {attachments.map((file) => file.name).join(", ")}
                  </small>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.375rem",
                }}
              >
                <label
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--landing-muted)",
                  }}
                >
                  {fbCopy.descLabel} <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={fbCopy.descPlaceholder}
                  disabled={loading}
                  required
                  style={{
                    width: "100%",
                    padding: "0.625rem 0.875rem",
                    borderRadius: "0.625rem",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--landing-line)",
                    color: "var(--color-ink)",
                    fontSize: "0.875rem",
                    outline: "none",
                    resize: "none",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              {category === "copyright" && (
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.5rem",
                    fontSize: "0.8125rem",
                    color: "var(--landing-muted)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={swornStatement}
                    onChange={(e) => setSwornStatement(e.target.checked)}
                    disabled={loading}
                    required
                    style={{ marginTop: "0.2rem" }}
                  />
                  <span>
                    Tôi cam kết thông tin và bằng chứng bản quyền (kèm giấy tờ
                    PDF nếu có) là trung thực, chính xác và tôi là chủ thể quyền
                    hoặc đại diện được ủy quyền hợp pháp.
                  </span>
                </label>
              )}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: "0.75rem",
                  marginTop: "0.5rem",
                  paddingTop: "0.75rem",
                  borderTop: "1px solid var(--landing-line)",
                }}
              >
                <button
                  type="button"
                  className="landing-button landing-button-quiet"
                  onClick={onClose}
                  disabled={loading}
                >
                  {fbCopy.cancel}
                </button>
                <button
                  type="submit"
                  className="landing-button"
                  disabled={loading}
                  style={{ minWidth: "120px" }}
                >
                  {loading ? fbCopy.submitting : fbCopy.submit}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
