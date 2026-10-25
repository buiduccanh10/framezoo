import classNames from "classnames";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { FancyModal, useModal } from "@/components/overlays/Modal";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { getBackendAuthHeadersAsync } from "@/utils/backendAuth";

export function FeedbackModal({ id = "feedback" }: { id?: string }) {
  const { t } = useTranslation();
  const modal = useModal(id);
  const backendUrl = useBackendUrl();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const resetForm = useCallback(() => {
    setTitle("");
    setDescription("");
    setError(null);
    setSuccess(false);
    setLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    modal.hide();
    setTimeout(() => {
      resetForm();
    }, 200);
  }, [modal, resetForm]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError(
        t(
          "feedback.errorRequired",
          "Vui lòng nhập đầy đủ tiêu đề và nội dung mô tả vấn đề.",
        ),
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const endpoint = backendUrl
        ? `${backendUrl.replace(/\/+$/, "")}/api/feedback`
        : "/api/feedback";

      const headers = await getBackendAuthHeadersAsync(
        endpoint,
        { "Content-Type": "application/json" },
        backendUrl || undefined,
      );

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.message ||
            t(
              "feedback.errorSubmit",
              "Gửi phản hồi thất bại, vui lòng thử lại",
            ),
        );
      }

      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 2500);
    } catch (err: any) {
      setError(
        err.message ||
          t(
            "feedback.errorSubmit",
            "Có lỗi xảy ra khi gửi phản hồi. Vui lòng thử lại sau.",
          ),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <FancyModal
      id={id}
      title={t("feedback.modalTitle", "Gửi phản hồi")}
      size="md"
    >
      {success ? (
        <div className="py-8 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
            <Icon icon={Icons.CIRCLE_CHECK} className="text-3xl" />
          </div>
          <h3 className="text-xl font-bold text-white">
            {t("feedback.successTitle", "Đã gửi phản hồi thành công!")}
          </h3>
          <p className="text-type-secondary text-sm max-w-sm mx-auto leading-relaxed">
            {t(
              "feedback.successDesc",
              "Cảm ơn bạn đã đóng góp ý kiến. Đội ngũ phát triển sẽ xem xét và xử lý vấn đề sớm nhất có thể.",
            )}
          </p>
          <div className="pt-2">
            <Button theme="purple" onClick={handleClose}>
              {t("feedback.close", "Đóng")}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <p className="text-sm text-type-secondary leading-relaxed">
            {t(
              "feedback.subtitle",
              "Hãy cho chúng tôi biết vấn đề hoặc lỗi bạn gặp phải trong quá trình trải nghiệm.",
            )}
          </p>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
              <Icon
                icon={Icons.CIRCLE_EXCLAMATION}
                className="shrink-0 text-base"
              />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-white/90 uppercase tracking-wide">
              {t("feedback.titleLabel", "1. Tiêu đề vấn đề")}{" "}
              <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t(
                "feedback.titlePlaceholder",
                "Ví dụ: Lỗi tải phụ đề phim, Giật lag khi xem...",
              )}
              maxLength={255}
              disabled={loading}
              className={classNames(
                "w-full rounded-xl px-4 py-2.5 text-sm text-white placeholder-type-dimmed",
                "bg-video-context-border/30 border border-white/10 focus:border-buttons-purple focus:outline-none transition-colors",
              )}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-white/90 uppercase tracking-wide">
              {t("feedback.descriptionLabel", "2. Mô tả vấn đề")}{" "}
              <span className="text-red-400">*</span>
            </label>
            <textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t(
                "feedback.descriptionPlaceholder",
                "Mô tả chi tiết vấn đề bạn gặp phải, các bước dẫn tới lỗi, hoặc mong muốn cải thiện...",
              )}
              disabled={loading}
              className={classNames(
                "w-full rounded-xl px-4 py-2.5 text-sm text-white placeholder-type-dimmed resize-none",
                "bg-video-context-border/30 border border-white/10 focus:border-buttons-purple focus:outline-none transition-colors",
              )}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4">
            <Button
              type="button"
              theme="secondary"
              onClick={handleClose}
              disabled={loading}
            >
              {t("feedback.cancel", "Hủy")}
            </Button>
            <Button
              type="submit"
              theme="purple"
              loading={loading}
              disabled={loading}
            >
              {t("feedback.submit", "Gửi phản hồi")}
            </Button>
          </div>
        </form>
      )}
    </FancyModal>
  );
}
