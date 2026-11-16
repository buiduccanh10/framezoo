import { type CSSProperties, useEffect, useRef, useState } from "react";

import {
  type LandingLocale,
  getInitialLandingLocale,
  getLandingCopy,
} from "./i18n";
import { LandingFooter } from "./LandingFooter";
import { ArrowUpRightIcon } from "./LandingIcon";
import { LandingLanguageSelector } from "./LandingLanguageSelector";
import { LandingParticles } from "./LandingParticles";

type SubtitleProviderId = "wyzie" | "subsource" | "opensubtitles";
type TestStatus = "idle" | "testing" | "success" | "error";

interface ProviderMeta {
  id: SubtitleProviderId;
  storageKey: string;
  portalUrl: string;
}

interface ProviderTestState {
  status: TestStatus;
  message: string;
}

export const SUBTITLE_PROVIDERS: readonly ProviderMeta[] = [
  {
    id: "wyzie",
    storageKey: "framezoo.wyzie_api_key",
    portalUrl: "https://store.wyzie.io/redeem",
  },
  {
    id: "subsource",
    storageKey: "framezoo.subsource_api_key",
    portalUrl: "https://subsource.net/api-docs",
  },
  {
    id: "opensubtitles",
    storageKey: "framezoo.opensubtitles_api_key",
    portalUrl: "https://www.opensubtitles.com/consumers",
  },
];

const INITIAL_SHOW_KEYS: Record<SubtitleProviderId, boolean> = {
  wyzie: false,
  subsource: false,
  opensubtitles: false,
};

const INITIAL_TEST_STATES: Record<SubtitleProviderId, ProviderTestState> = {
  wyzie: { status: "idle", message: "" },
  subsource: { status: "idle", message: "" },
  opensubtitles: { status: "idle", message: "" },
};

const cardStyle: CSSProperties = {
  background: "rgba(25, 18, 18, 0.8)",
  border: "1px solid rgba(255, 225, 210, 0.12)",
  borderRadius: "16px",
  padding: "24px",
  marginBottom: "24px",
};

const stepBadgeStyle: CSSProperties = {
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
  flexShrink: 0,
};

const providerBlockStyle: CSSProperties = {
  padding: "16px",
  borderRadius: "12px",
  background: "rgba(12, 9, 9, 0.55)",
  border: "1px solid rgba(255, 225, 210, 0.1)",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "11px 56px 11px 14px",
  borderRadius: "10px",
  border: "1px solid rgba(255, 225, 210, 0.2)",
  background: "rgba(10, 8, 8, 0.9)",
  color: "#fff",
  fontSize: "0.95rem",
  fontFamily: "monospace",
  outline: "none",
  boxSizing: "border-box",
};

function readInitialKeys(): Record<SubtitleProviderId, string> {
  const result: Record<SubtitleProviderId, string> = {
    wyzie: "",
    subsource: "",
    opensubtitles: "",
  };
  if (typeof window === "undefined") return result;

  const urlParams = new URLSearchParams(window.location.search);
  const paramWyzie = (
    urlParams.get("key") ||
    urlParams.get("wyzie_key") ||
    ""
  ).trim();

  for (const provider of SUBTITLE_PROVIDERS) {
    if (provider.id === "wyzie" && paramWyzie) {
      result.wyzie = paramWyzie;
      continue;
    }
    try {
      result[provider.id] =
        window.localStorage.getItem(provider.storageKey) || "";
    } catch {
      // Storage unavailable
    }
  }
  return result;
}

export function SubtitlesConfigurePage() {
  const [locale, setLocale] = useState<LandingLocale>(getInitialLandingLocale);
  const copy = getLandingCopy(locale);
  const t = copy.subtitlesConfigure;

  const [keys, setKeys] =
    useState<Record<SubtitleProviderId, string>>(readInitialKeys);
  const [showKeys, setShowKeys] =
    useState<Record<SubtitleProviderId, boolean>>(INITIAL_SHOW_KEYS);
  const [testStates, setTestStates] =
    useState<Record<SubtitleProviderId, ProviderTestState>>(
      INITIAL_TEST_STATES,
    );

  const [copiedManifest, setCopiedManifest] = useState(false);
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

  // Same-origin endpoints ensure /addon/* proxies cleanly in both Vite dev and prod nginx.
  const getApiUrl = (endpoint: string) => endpoint;

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
            setKeys((prev) => ({
              wyzie:
                data.credentials?.wyzie || data.currentApiKey || prev.wyzie,
              subsource: data.credentials?.subsource || prev.subsource,
              opensubtitles:
                data.credentials?.opensubtitles || prev.opensubtitles,
            }));
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

  const handleKeyChange = (provider: ProviderMeta, rawValue: string) => {
    const trimmed = rawValue.trim();
    setKeys((prev) => ({ ...prev, [provider.id]: rawValue }));
    try {
      if (trimmed) {
        window.localStorage.setItem(provider.storageKey, trimmed);
      } else {
        window.localStorage.removeItem(provider.storageKey);
      }
    } catch {
      // Storage unavailable
    }
    setTestStates((prev) => ({
      ...prev,
      [provider.id]: { status: "idle", message: "" },
    }));
  };

  const handleTestKey = async (providerId: SubtitleProviderId) => {
    const trimmed = keys[providerId].trim();
    const providerName = t.providers[providerId].name;

    if (!trimmed) {
      setTestStates((prev) => ({
        ...prev,
        [providerId]: { status: "error", message: t.step2.messages.empty },
      }));
      return;
    }

    setTestStates((prev) => ({
      ...prev,
      [providerId]: {
        status: "testing",
        message: t.step2.messages.verifyingProvider.replace(
          "{{provider}}",
          providerName,
        ),
      },
    }));

    const setResult = (status: TestStatus, message: string) => {
      setTestStates((prev) => ({
        ...prev,
        [providerId]: { status, message },
      }));
    };

    try {
      const response = await fetch(getApiUrl("/addon/subtitles/api/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ provider: providerId, apiKey: trimmed }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          valid?: boolean;
          status?: string;
          httpStatus?: number;
        };
        if (data.valid) {
          setResult("success", `✓ ${t.step2.messages.valid}`);
          return;
        }
        if (data.status === "invalid") {
          setResult("error", `✕ ${t.step2.messages.invalid}`);
          return;
        }
        if (data.status === "rate_limit") {
          setResult("error", `✕ ${t.step2.messages.rateLimit}`);
          return;
        }
        if (data.status === "error" && data.httpStatus) {
          setResult(
            "error",
            `✕ ${t.step2.messages.serverErrorProvider
              .replace("{{provider}}", providerName)
              .replace("{{status}}", String(data.httpStatus))}`,
          );
          return;
        }
        setResult(
          "error",
          `✕ ${t.step2.messages.networkErrorProvider.replace(
            "{{provider}}",
            providerName,
          )}`,
        );
        return;
      }

      if (providerId !== "wyzie") {
        setResult(
          "error",
          `✕ ${t.step2.messages.serverErrorProvider
            .replace("{{provider}}", providerName)
            .replace("{{status}}", String(response.status))}`,
        );
        return;
      }
    } catch {
      if (providerId !== "wyzie") {
        setResult(
          "error",
          `✕ ${t.step2.messages.networkErrorProvider.replace(
            "{{provider}}",
            providerName,
          )}`,
        );
        return;
      }
    }

    // Fallback for standalone frontend dev when backend proxy is unavailable (Wyzie allows browser CORS).
    try {
      const wyzieRes = await fetch(
        `https://sub.wyzie.io/search?id=tt1877830&key=${encodeURIComponent(trimmed)}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (wyzieRes.ok) {
        setResult("success", `✓ ${t.step2.messages.valid}`);
      } else if (wyzieRes.status === 401 || wyzieRes.status === 403) {
        setResult("error", `✕ ${t.step2.messages.invalid}`);
      } else if (wyzieRes.status === 429) {
        setResult("error", `✕ ${t.step2.messages.rateLimit}`);
      } else {
        setResult(
          "error",
          `✕ ${t.step2.messages.serverErrorProvider
            .replace("{{provider}}", providerName)
            .replace("{{status}}", String(wyzieRes.status))}`,
        );
      }
    } catch {
      setResult(
        "error",
        `✕ ${t.step2.messages.networkErrorProvider.replace(
          "{{provider}}",
          providerName,
        )}`,
      );
    }
  };

  const getManifestUrl = () => {
    const trimmed = keys.wyzie.trim();
    const origin =
      typeof window !== "undefined" && window.location.origin
        ? window.location.origin
        : "https://framezoo.top";
    const base = `${origin}/addon/subtitles/manifest.json`;
    if (!trimmed) return base;
    return `${base}?key=${encodeURIComponent(trimmed)}`;
  };

  const handleOpenFramezoo = async () => {
    if (!configureToken) return;

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
          credentials: {
            wyzie: keys.wyzie.trim(),
            subsource: keys.subsource.trim(),
            opensubtitles: keys.opensubtitles.trim(),
          },
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

    window.location.href = `framezoo://addons?subtitles_configured=${isSuccess ? "success" : "failed"}`;
  };

  const handleCopyManifest = async () => {
    try {
      await navigator.clipboard.writeText(getManifestUrl());
      setCopiedManifest(true);
      setTimeout(() => setCopiedManifest(false), 2500);
    } catch {
      // Clipboard unavailable
    }
  };

  const hasNonWyzieKeys = Boolean(
    keys.subsource.trim() || keys.opensubtitles.trim(),
  );

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
            {t.hero.multiDescription}
          </p>
        </section>

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
            <span>
              {t.account.configuringFor} <strong>{account.nickname}</strong>
            </span>
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

        {/* Step 1: Uniform Subtitle Provider Keys */}
        <section className="configure-card" style={cardStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "10px",
            }}
          >
            <span style={stepBadgeStyle}>{t.providersStep.step}</span>
            <h2 style={{ fontSize: "1.2rem", fontWeight: "600", margin: 0 }}>
              {t.providersStep.title}
            </h2>
          </div>

          <p
            style={{
              color: "var(--landing-muted, #a39595)",
              fontSize: "0.92rem",
              lineHeight: "1.55",
              margin: "0 0 18px",
            }}
          >
            {t.providersStep.description}
          </p>

          <div
            style={{ display: "flex", flexDirection: "column", gap: "14px" }}
          >
            {SUBTITLE_PROVIDERS.map((provider) => {
              const providerCopy = t.providers[provider.id];
              const value = keys[provider.id];
              const trimmed = value.trim();
              const isShown = showKeys[provider.id];
              const testState = testStates[provider.id];

              return (
                <div
                  key={provider.id}
                  data-provider-card={provider.id}
                  style={providerBlockStyle}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "10px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <label
                        htmlFor={`subtitle-key-${provider.id}`}
                        style={{ fontSize: "1rem", fontWeight: "600" }}
                      >
                        {providerCopy.name}
                      </label>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "2px 8px",
                          borderRadius: "999px",
                          background: "rgba(255, 255, 255, 0.08)",
                          color: "var(--landing-muted, #a39595)",
                        }}
                      >
                        {t.providersStep.optionalBadge}
                      </span>
                    </div>

                    <a
                      href={provider.portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        background: "rgba(228, 79, 79, 0.14)",
                        color: "#ff8585",
                        border: "1px solid rgba(228, 79, 79, 0.35)",
                        borderRadius: "8px",
                        padding: "6px 12px",
                        fontSize: "0.84rem",
                        fontWeight: "500",
                        textDecoration: "none",
                      }}
                    >
                      <span>{t.providersStep.getKeyButton}</span>
                      <ArrowUpRightIcon />
                    </a>
                  </div>

                  <p
                    style={{
                      margin: 0,
                      fontSize: "0.86rem",
                      color: "var(--landing-muted, #a39595)",
                      lineHeight: "1.45",
                    }}
                  >
                    {providerCopy.portalHint}
                  </p>

                  <div style={{ position: "relative", width: "100%" }}>
                    <input
                      id={`subtitle-key-${provider.id}`}
                      type={isShown ? "text" : "password"}
                      value={value}
                      onChange={(e) =>
                        handleKeyChange(provider, e.target.value)
                      }
                      placeholder={providerCopy.placeholder}
                      autoComplete="off"
                      spellCheck={false}
                      style={inputStyle}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowKeys((prev) => ({
                          ...prev,
                          [provider.id]: !prev[provider.id],
                        }))
                      }
                      style={{
                        position: "absolute",
                        right: "12px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        color: "var(--landing-muted, #a39595)",
                        cursor: "pointer",
                        fontSize: "0.82rem",
                        padding: "4px",
                      }}
                    >
                      {isShown ? t.step2.hide : t.step2.show}
                    </button>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "10px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => void handleTestKey(provider.id)}
                      disabled={testState.status === "testing" || !trimmed}
                      style={{
                        padding: "7px 14px",
                        borderRadius: "8px",
                        background: trimmed
                          ? "rgba(255, 255, 255, 0.1)"
                          : "rgba(255, 255, 255, 0.05)",
                        border: "1px solid rgba(255, 255, 255, 0.18)",
                        color: trimmed ? "#fff" : "rgba(255, 255, 255, 0.4)",
                        cursor: trimmed ? "pointer" : "not-allowed",
                        fontSize: "0.85rem",
                        fontWeight: "500",
                      }}
                    >
                      {testState.status === "testing"
                        ? t.step2.testing
                        : t.step2.testButton}
                    </button>

                    {trimmed && (
                      <button
                        type="button"
                        onClick={() => handleKeyChange(provider, "")}
                        style={{
                          padding: "7px 12px",
                          borderRadius: "8px",
                          background: "none",
                          border: "none",
                          color: "rgba(255, 120, 120, 0.85)",
                          cursor: "pointer",
                          fontSize: "0.84rem",
                        }}
                      >
                        {t.step2.clearButton}
                      </button>
                    )}

                    {testState.message && (
                      <span
                        style={{
                          fontSize: "0.84rem",
                          padding: "5px 10px",
                          borderRadius: "6px",
                          background:
                            testState.status === "success"
                              ? "rgba(46, 133, 64, 0.2)"
                              : testState.status === "testing"
                                ? "rgba(255, 255, 255, 0.06)"
                                : "rgba(180, 40, 40, 0.2)",
                          border:
                            testState.status === "success"
                              ? "1px solid rgba(46, 133, 64, 0.4)"
                              : testState.status === "testing"
                                ? "1px solid rgba(255, 255, 255, 0.14)"
                                : "1px solid rgba(180, 40, 40, 0.4)",
                          color:
                            testState.status === "success"
                              ? "#86efac"
                              : testState.status === "testing"
                                ? "var(--landing-muted, #a39595)"
                                : "#fca5a5",
                        }}
                      >
                        {testState.message}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Step 2: Install & Apply */}
        <section
          className="configure-card"
          style={{ ...cardStyle, marginBottom: "32px" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "16px",
            }}
          >
            <span style={stepBadgeStyle}>{t.step3.step}</span>
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
            <button
              type="button"
              onClick={handleOpenFramezoo}
              disabled={!configureToken || isSavingRemote}
              title={
                !configureToken
                  ? t.step3.openFramezooDisabledTooltip
                  : undefined
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "12px 24px",
                background: !configureToken
                  ? "rgba(228, 79, 79, 0.25)"
                  : "#e44f4f",
                color: !configureToken ? "rgba(255, 255, 255, 0.45)" : "#fff",
                borderRadius: "10px",
                fontWeight: "600",
                border: "none",
                cursor: !configureToken
                  ? "not-allowed"
                  : isSavingRemote
                    ? "wait"
                    : "pointer",
                fontSize: "0.95rem",
                boxShadow: !configureToken
                  ? "none"
                  : "0 4px 14px rgba(228, 79, 79, 0.3)",
                transition: "all 0.2s",
              }}
            >
              <span>
                {isSavingRemote ? t.account.saving : t.step3.openFramezoo}
              </span>
            </button>

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
              {hasNonWyzieKeys ? ` ${t.providersStep.manifestHint}` : ""}
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
              lineHeight: "1.55",
            }}
          >
            <strong>{t.step3.noticeLabel}</strong> {t.step3.noticeText}{" "}
            <a
              href="/legal/privacy"
              style={{ color: "#e2e8f0", textDecoration: "underline" }}
            >
              {t.step3.privacyLinkLabel}
            </a>{" "}
            &amp;{" "}
            <a
              href="/legal/dmca"
              style={{ color: "#e2e8f0", textDecoration: "underline" }}
            >
              {t.step3.takedownLinkLabel}
            </a>
            .
          </div>
        </section>
      </main>

      <LandingFooter copy={copy} />
    </div>
  );
}
