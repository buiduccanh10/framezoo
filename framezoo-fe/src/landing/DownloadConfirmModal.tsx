import { useEffect } from "react";

import type { AppDownloadOption } from "@/backend/download";

import type { LandingCopy } from "./i18n";
import { ArrowUpRightIcon, DownloadIcon } from "./LandingIcon";

interface DownloadConfirmModalProps {
  isOpen: boolean;
  option: AppDownloadOption | null;
  copy: LandingCopy;
  onClose: () => void;
  onConfirm: (option: AppDownloadOption) => void;
}

export function DownloadConfirmModal({
  isOpen,
  option,
  copy,
  onClose,
  onConfirm,
}: DownloadConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !option) return null;

  const isMac = option.id.startsWith("mac-");
  const modalTitle = isMac
    ? copy.downloadConfirm.macTitle
    : copy.downloadConfirm.winTitle;
  const guideHref = isMac ? "/guide/install#mac" : "/guide/install#windows";

  return (
    <div
      className="landing-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="landing-modal-card">
        <button
          type="button"
          className="landing-modal-close"
          onClick={onClose}
          aria-label={copy.downloadConfirm.cancel}
        >
          ✕
        </button>

        <div className="landing-modal-header">
          <span className="landing-platform-badge">{option.label}</span>
          <h3 id="confirm-modal-title">{modalTitle}</h3>
        </div>

        <div className="landing-modal-content">
          <div className="landing-modal-notice">
            <span className="landing-modal-notice-icon">⚠️</span>
            <p>
              {isMac
                ? copy.downloadConfirm.macNotice
                : copy.downloadConfirm.winNotice}
            </p>
          </div>

          <div className="landing-modal-steps">
            {isMac ? (
              <>
                <div className="landing-step-row">
                  <span className="landing-step-num">1</span>
                  <div>
                    <strong>{copy.installGuide.mac.step1Title}</strong>
                    <p>{copy.installGuide.mac.step1Desc}</p>
                  </div>
                </div>
                <div className="landing-step-row">
                  <span className="landing-step-num">2</span>
                  <div>
                    <strong>{copy.installGuide.mac.step3Steps[1]}</strong>
                    <p>{copy.installGuide.mac.step3Steps[2]}</p>
                  </div>
                </div>
                <div className="landing-step-row">
                  <span className="landing-step-num">3</span>
                  <div>
                    <strong>{copy.installGuide.mac.step3Steps[3]}</strong>
                    <p>{copy.installGuide.mac.note}</p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="landing-step-row">
                  <span className="landing-step-num">1</span>
                  <div>
                    <strong>{copy.installGuide.win.step1Title}</strong>
                    <p>{copy.installGuide.win.step1Desc}</p>
                  </div>
                </div>
                <div className="landing-step-row">
                  <span className="landing-step-num">2</span>
                  <div>
                    <strong>{copy.installGuide.win.step3Steps[0]}</strong>
                    <p>{copy.installGuide.win.step3Steps[1]}</p>
                  </div>
                </div>
                <div className="landing-step-row">
                  <span className="landing-step-num">3</span>
                  <div>
                    <strong>{copy.installGuide.win.step3Steps[2]}</strong>
                    <p>{copy.installGuide.win.note}</p>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="landing-modal-doc-link">
            <a href={guideHref} target="_blank" rel="noreferrer">
              {copy.downloadConfirm.viewGuide} <ArrowUpRightIcon />
            </a>
          </div>
        </div>

        <div className="landing-modal-actions">
          <button
            type="button"
            className="landing-button landing-button-quiet"
            onClick={onClose}
          >
            {copy.downloadConfirm.cancel}
          </button>
          <button
            type="button"
            className="landing-button landing-button-primary"
            onClick={() => onConfirm(option)}
          >
            <DownloadIcon />
            {copy.downloadConfirm.confirmDownload}
          </button>
        </div>
      </div>
    </div>
  );
}
