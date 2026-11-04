import { useEffect, useRef, useState } from "react";

import {
  type LandingLocale,
  getInitialLandingLocale,
  getLandingCopy,
} from "./i18n";
import { LandingFooter } from "./LandingFooter";
import { ArrowUpRightIcon } from "./LandingIcon";
import { LandingLanguageSelector } from "./LandingLanguageSelector";
import { LandingParticles } from "./LandingParticles";

const WYZIE_REDEEM_URL = "https://store.wyzie.io/redeem";
const BASE_MANIFEST_URL = "https://framezoo.top/addon/subtitles/manifest.json";

export function SubtitlesConfigurePage() {
  const [locale, setLocale] = useState<LandingLocale>(getInitialLandingLocale);
  const copy = getLandingCopy(locale);
  const t = copy.subtitlesConfigure;

  const [apiKey, setApiKey] = useState(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const paramKey = urlParams.get("key") || urlParams.get("wyzie_key") || "";
      if (paramKey) return paramKey.trim();
      try {
        return window.localStorage.getItem("framezoo.wyzie_api_key") || "";
      } catch {
        return "";
      }
    }
    return "";
  });

  const [showKey, setShowKey] = useState(false);
  const [copiedManifest, setCopiedManifest] = useState(false);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState("");

  const [account, setAccount] = useState<{
    nickname: string;
    userId: string;
  } | null>(null);
  const [configureToken, setConfigureToken] = useState<string>("");
  const [isVerifyingTicket, setIsVerifyingTicket] = useState(false);
  const [isSavingRemote, setIsSavingRemote] = useState(false);
  const hasVerifiedRef = useRef(false);
  const [saveRemoteStatus, setSaveRemoteStatus] = useState<
    "idle" | "success" | "error" | "warning"
  >("idle");
  const [saveRemoteMessage, setSaveRemoteMessage] = useState("");

  useEffect(() => {
    document.title = t.pageTitle;
  }, [t.pageTitle]);

  // Handle one-time ticket verification from Desktop App handoff
  const getApiUrl = (endpoint: string) => {
    // The public frontend proxies /addon/* to the backend in both Vite and prod.
    // Keep ticket/session calls same-origin so a stale backend build URL cannot
    // send the one-time ticket to a different host.
    return endpoint;
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlParams = new URLSearchParams(window.location.search);
    const ticket = urlParams.get("ticket");
    if (!ticket || hasVerifiedRef.current) return;
    hasVerifiedRef.current = true;

    setIsVerifyingTicket(true);
    (async () => {
      try {
        const response = await fetch(
          getApiUrl(
            `/addon/subtitles/api/verify?ticket=${encodeURIComponent(ticket)}`,
          ),
        );
        if (response.ok) {
          const data = await response.json();
          if (data.valid) {
            setAccount({ nickname: data.nickname, userId: data.userId });
            setConfigureToken(data.configureToken || "");
            if (data.currentApiKey) {
              setApiKey(data.currentApiKey);
            }
            // Clear the single-use ticket from address bar
            window.history.replaceState({}, "", window.location.pathname);
          }
        }
      } catch (err) {
        console.warn("[configure] Ticket verification failed:", err);
      } finally {
        setIsVerifyingTicket(false);
      }
    })();
  }, []);

  const handleSaveLocal = (newKey: string) => {
    const trimmed = newKey.trim();
    setApiKey(trimmed);
    try {
      if (trimmed) {
        window.localStorage.setItem("framezoo.wyzie_api_key", trimmed);
      } else {
        window.localStorage.removeItem("framezoo.wyzie_api_key");
      }
    } catch {
      // Ignore in private storage
    }
    setTestStatus("idle");
    setTestMessage("");
  };

  const handleTestKey = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setTestStatus("error");
      setTestMessage(t.step2.messages.empty);
      return;
    }

    setTestStatus("testing");
    setTestMessage(t.step2.messages.verifying);

    try {
      // Test search request with a well-known IMDb ID (tt1877830 - Men in Black 3)
      const testUrl = `https://sub.wyzie.io/search?id=tt1877830&key=${encodeURIComponent(trimmed)}`;
      const response = await fetch(testUrl, {
        signal: AbortSignal.timeout(8000),
      });

      if (response.ok) {
        setTestStatus("success");
        setTestMessage(`✓ ${t.step2.messages.valid}`);
      } else if (response.status === 401 || response.status === 403) {
        setTestStatus("error");
        setTestMessage(`✕ ${t.step2.messages.invalid}`);
      } else if (response.status === 429) {
        setTestStatus("error");
        setTestMessage(`✕ ${t.step2.messages.rateLimit}`);
      } else {
        setTestStatus("error");
        setTestMessage(
          `✕ ${t.step2.messages.serverError.replace("{{status}}", String(response.status))}`,
        );
      }
    } catch {
      setTestStatus("error");
      setTestMessage(`✕ ${t.step2.messages.networkError}`);
    }
  };

  const getManifestUrl = () => {
    const trimmed = apiKey.trim();
    const origin =
      typeof window !== "undefined" && window.location.origin
        ? window.location.origin
        : "https://framezoo.top";
    const base = `${origin}/addon/subtitles/manifest.json`;
    if (!trimmed) return base;
    return `${base}?key=${encodeURIComponent(trimmed)}`;
  };

  const getDesktopDeepLink = (status?: "success" | "failed") => {
    return status
      ? `framezoo://addons?subtitles_configured=${status}`
      : "framezoo://addons";
  };

  const handleOpenFramezoo = async () => {
    if (!configureToken) return;
    const trimmed = apiKey.trim();
    if (!trimmed) return;

    // 1. If we have a configureToken from Desktop handoff, post to backend to persist to user account
    setIsSavingRemote(true);
    setSaveRemoteStatus("idle");
    setSaveRemoteMessage("");

    let isSuccess = false;
    try {
      const response = await fetch(getApiUrl("/addon/subtitles/api/save"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configureToken,
          apiKey: trimmed,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        isSuccess = true;
        setSaveRemoteStatus("success");
        setSaveRemoteMessage(`✓ ${t.account.saveSuccess}`);
      } else {
        setSaveRemoteStatus("error");
        setSaveRemoteMessage(data.message || `✕ ${t.account.saveFailed}`);
      }
    } catch {
      setSaveRemoteStatus("error");
      setSaveRemoteMessage(`✕ ${t.account.saveNetworkError}`);
    } finally {
      setIsSavingRemote(false);
    }

    // 2. Trigger desktop deep link to bring Framezoo to foreground
    const deepLink = getDesktopDeepLink(isSuccess ? "success" : "failed");
    window.location.href = deepLink;
  };

  const handleCopyManifest = async () => {
    try {
      await navigator.clipboard.writeText(getManifestUrl());
      setCopiedManifest(true);
      setTimeout(() => setCopiedManifest(false), 2500);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="landing-shell">
      <div className="landing-ambient landing-ambient-one" aria-hidden="true" />
      <div className="landing-ambient landing-ambient-two" aria-hidden="true" />
      <LandingParticles />

      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label={copy.nav.homeAria}>
          <img
            src="/framezoo-logo.svg"
            width="138"
            height="40"
            alt="Framezoo"
          />
        </a>
        <nav className="landing-nav-links" aria-label={copy.nav.primaryAria}>
          <a href="/">{copy.nav.home}</a>
          <a href="/experience">{copy.nav.features}</a>
          <a href="/ecosystem">{copy.nav.addons}</a>
          <a href="/download">{copy.nav.download}</a>
          <LandingLanguageSelector
            locale={locale}
            label={copy.nav.language}
            onChange={setLocale}
          />
        </nav>
      </header>

      <main
        className="container configure-addon-page"
        style={{ maxWidth: "800px", margin: "40px auto", padding: "0 20px" }}
      >
        {/* Title Header */}
        <section
          className="configure-hero"
          style={{ textAlign: "center", marginBottom: "32px" }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "64px",
              height: "64px",
              borderRadius: "16px",
              background: "rgba(228, 79, 79, 0.15)",
              border: "1px solid rgba(228, 79, 79, 0.3)",
              marginBottom: "16px",
            }}
          >
            <img
              src="/favicon-192.png"
              width="44"
              height="44"
              alt="Framezoo Subtitles"
              style={{ objectFit: "contain" }}
            />
          </div>
          <h1
            style={{ fontSize: "2rem", fontWeight: "700", marginBottom: "8px" }}
          >
            {t.hero.title}
          </h1>
          <p
            style={{
              color: "var(--landing-muted, #a39595)",
              fontSize: "1rem",
              maxWidth: "600px",
              margin: "0 auto",
            }}
          >
            {t.hero.description}
          </p>
        </section>

        {/* Account Handoff Status */}
        {isVerifyingTicket && (
          <div
            style={{
              padding: "12px 18px",
              borderRadius: "12px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "var(--landing-muted, #a39595)",
              marginBottom: "20px",
              fontSize: "0.9rem",
              textAlign: "center",
            }}
          >
            {t.account.verifying}
          </div>
        )}

        {account && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 18px",
              borderRadius: "12px",
              background: "rgba(46, 133, 64, 0.15)",
              border: "1px solid rgba(46, 133, 64, 0.35)",
              color: "#86efac",
              marginBottom: "24px",
              fontSize: "0.95rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span>
                {t.account.configuringFor} <strong>{account.nickname}</strong>
              </span>
            </div>
            <span
              style={{
                fontSize: "0.8rem",
                background: "rgba(46, 133, 64, 0.3)",
                padding: "3px 8px",
                borderRadius: "6px",
              }}
            >
              {t.account.desktopLinked}
            </span>
          </div>
        )}

        {/* Step 1: Guide */}
        <section
          className="configure-card"
          style={{
            background: "rgba(25, 18, 18, 0.8)",
            border: "1px solid rgba(255, 225, 210, 0.12)",
            borderRadius: "16px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "16px",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                background: "#e44f4f",
                color: "#fff",
                fontWeight: "bold",
                fontSize: "14px",
              }}
            >
              {t.step1.step}
            </span>
            <h2 style={{ fontSize: "1.2rem", fontWeight: "600", margin: 0 }}>
              {t.step1.title}
            </h2>
          </div>

          <p
            style={{
              color: "var(--landing-muted, #a39595)",
              fontSize: "0.95rem",
              lineHeight: "1.6",
              marginBottom: "16px",
            }}
          >
            {t.step1.description}
          </p>

          <a
            href={WYZIE_REDEEM_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              background: "rgba(228, 79, 79, 0.15)",
              color: "#ff6b6b",
              border: "1px solid rgba(228, 79, 79, 0.4)",
              borderRadius: "10px",
              padding: "10px 18px",
              fontWeight: "500",
              textDecoration: "none",
              transition: "all 0.2s",
            }}
          >
            <span>{t.step1.openStore}</span>
            <ArrowUpRightIcon />
          </a>

          <ol
            style={{
              marginTop: "16px",
              paddingLeft: "20px",
              color: "var(--landing-muted, #a39595)",
              fontSize: "0.9rem",
              lineHeight: "1.6",
            }}
          >
            <li>{t.step1.step1}</li>
            <li>{t.step1.step2}</li>
            <li>{t.step1.step3}</li>
          </ol>
        </section>

        {/* Step 2: Input API Key */}
        <section
          className="configure-card"
          style={{
            background: "rgba(25, 18, 18, 0.8)",
            border: "1px solid rgba(255, 225, 210, 0.12)",
            borderRadius: "16px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "16px",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                background: "#e44f4f",
                color: "#fff",
                fontWeight: "bold",
                fontSize: "14px",
              }}
            >
              {t.step2.step}
            </span>
            <h2 style={{ fontSize: "1.2rem", fontWeight: "600", margin: 0 }}>
              {t.step2.title}
            </h2>
          </div>

          <div
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <div style={{ position: "relative", width: "100%" }}>
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => handleSaveLocal(e.target.value)}
                placeholder={t.step2.placeholder}
                style={{
                  width: "100%",
                  padding: "12px 48px 12px 16px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255, 225, 210, 0.2)",
                  background: "rgba(10, 8, 8, 0.9)",
                  color: "#fff",
                  fontSize: "1rem",
                  fontFamily: "monospace",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--landing-muted, #a39595)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  padding: "4px",
                }}
              >
                {showKey ? t.step2.hide : t.step2.show}
              </button>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                marginTop: "4px",
              }}
            >
              <button
                type="button"
                onClick={handleTestKey}
                disabled={testStatus === "testing" || !apiKey.trim()}
                style={{
                  padding: "8px 18px",
                  borderRadius: "8px",
                  background: apiKey.trim()
                    ? "rgba(255, 255, 255, 0.1)"
                    : "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  color: apiKey.trim() ? "#fff" : "rgba(255, 255, 255, 0.4)",
                  cursor: apiKey.trim() ? "pointer" : "not-allowed",
                  fontSize: "0.9rem",
                  fontWeight: "500",
                }}
              >
                {testStatus === "testing"
                  ? t.step2.testing
                  : t.step2.testButton}
              </button>

              {apiKey.trim() && (
                <button
                  type="button"
                  onClick={() => handleSaveLocal("")}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "8px",
                    background: "none",
                    border: "none",
                    color: "rgba(255, 120, 120, 0.8)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  {t.step2.clearButton}
                </button>
              )}
            </div>

            {testMessage && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background:
                    testStatus === "success"
                      ? "rgba(46, 133, 64, 0.2)"
                      : "rgba(180, 40, 40, 0.2)",
                  border:
                    testStatus === "success"
                      ? "1px solid rgba(46, 133, 64, 0.4)"
                      : "1px solid rgba(180, 40, 40, 0.4)",
                  color: testStatus === "success" ? "#86efac" : "#fca5a5",
                }}
              >
                {testMessage}
              </div>
            )}
          </div>
        </section>

        {/* Step 3: Install & Apply */}
        <section
          className="configure-card"
          style={{
            background: "rgba(25, 18, 18, 0.8)",
            border: "1px solid rgba(255, 225, 210, 0.12)",
            borderRadius: "16px",
            padding: "24px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "16px",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                background: "#e44f4f",
                color: "#fff",
                fontWeight: "bold",
                fontSize: "14px",
              }}
            >
              {t.step3.step}
            </span>
            <h2 style={{ fontSize: "1.2rem", fontWeight: "600", margin: 0 }}>
              {t.step3.title}
            </h2>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexWrap: "wrap",
              gap: "14px",
            }}
          >
            {/* Option 1: Open Framezoo */}
            <button
              type="button"
              onClick={handleOpenFramezoo}
              disabled={!configureToken || isSavingRemote || !apiKey.trim()}
              title={
                !configureToken
                  ? t.step3.openFramezooDisabledTooltip
                  : !apiKey.trim()
                    ? t.step2.messages.empty
                    : undefined
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "12px 24px",
                background:
                  !configureToken || !apiKey.trim()
                    ? "rgba(228, 79, 79, 0.25)"
                    : "#e44f4f",
                color:
                  !configureToken || !apiKey.trim()
                    ? "rgba(255, 255, 255, 0.45)"
                    : "#fff",
                borderRadius: "10px",
                fontWeight: "600",
                border: "none",
                cursor:
                  !configureToken || !apiKey.trim()
                    ? "not-allowed"
                    : isSavingRemote
                      ? "wait"
                      : "pointer",
                fontSize: "0.95rem",
                boxShadow:
                  !configureToken || !apiKey.trim()
                    ? "none"
                    : "0 4px 14px rgba(228, 79, 79, 0.3)",
                transition: "all 0.2s",
              }}
            >
              <span>
                {isSavingRemote ? t.account.saving : t.step3.openFramezoo}
              </span>
            </button>

            {/* Separator: or */}
            <span
              style={{
                color: "var(--landing-muted, #a39595)",
                fontSize: "0.9rem",
                fontWeight: "500",
                textTransform: "lowercase",
                padding: "0 4px",
              }}
            >
              {t.step3.or}
            </span>

            {/* Option 2: Copy Manifest URL */}
            <button
              type="button"
              onClick={handleCopyManifest}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "12px 22px",
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                color: "#e2e8f0",
                borderRadius: "10px",
                fontWeight: "500",
                cursor: "pointer",
                fontSize: "0.95rem",
                transition: "all 0.2s",
              }}
            >
              <span>
                {copiedManifest ? `✓ ${t.step3.copied}` : t.step3.copyManifest}
              </span>
            </button>
          </div>

          {!configureToken && !isVerifyingTicket && (
            <div
              style={{
                marginTop: "16px",
                padding: "10px 14px",
                borderRadius: "8px",
                fontSize: "0.85rem",
                background: "rgba(234, 179, 8, 0.08)",
                border: "1px solid rgba(234, 179, 8, 0.2)",
                color: "#fde047",
                lineHeight: "1.5",
                textAlign: "center",
              }}
            >
              {t.step3.notConnectedNotice}
            </div>
          )}

          {saveRemoteMessage && (
            <div
              style={{
                marginTop: "16px",
                padding: "10px 14px",
                borderRadius: "8px",
                fontSize: "0.9rem",
                textAlign: "center",
                background:
                  saveRemoteStatus === "success"
                    ? "rgba(46, 133, 64, 0.2)"
                    : saveRemoteStatus === "warning"
                      ? "rgba(217, 119, 6, 0.2)"
                      : "rgba(180, 40, 40, 0.2)",
                border:
                  saveRemoteStatus === "success"
                    ? "1px solid rgba(46, 133, 64, 0.4)"
                    : saveRemoteStatus === "warning"
                      ? "1px solid rgba(217, 119, 6, 0.4)"
                      : "1px solid rgba(180, 40, 40, 0.4)",
                color:
                  saveRemoteStatus === "success"
                    ? "#86efac"
                    : saveRemoteStatus === "warning"
                      ? "#fde047"
                      : "#fca5a5",
              }}
            >
              {saveRemoteMessage}
            </div>
          )}

          <div
            style={{
              marginTop: "20px",
              padding: "12px 16px",
              borderRadius: "8px",
              background: "rgba(0, 0, 0, 0.3)",
              border: "1px dashed rgba(255, 255, 255, 0.1)",
              color: "var(--landing-muted, #a39595)",
              fontSize: "0.85rem",
              lineHeight: "1.5",
            }}
          >
            <strong>{t.step3.noticeLabel}</strong> {t.step3.noticeText}
          </div>
        </section>
      </main>

      <LandingFooter copy={copy} />
    </div>
  );
}
