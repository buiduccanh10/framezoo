/** @vitest-environment jsdom */
import i18next from "i18next";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import enCopy from "@/assets/locales/en.json";

import { OtpVerificationPart } from "./OtpVerificationPart";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

describe("OtpVerificationPart", () => {
  const i18n = i18next.createInstance();
  const container = document.createElement("div");
  const root = createRoot(container);

  const mockChallenge = {
    challengeId: "test-challenge-123",
    expiresIn: 300,
    resendAfter: 60,
  };

  beforeAll(async () => {
    await i18n.init({ lng: "en", resources: { en: { translation: enCopy } } });
  });

  afterEach(() => {
    act(() => root.render(<></>));
  });

  it("renders sent to email text and spam notice when email is provided", () => {
    act(() => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <OtpVerificationPart
            title="Verify your email"
            description="Default fallback description"
            email="user@example.com"
            challenge={mockChallenge}
            onVerify={vi.fn()}
            onResend={vi.fn()}
          />
        </I18nextProvider>,
      );
    });

    expect(container.textContent).toContain("user@example.com");
    expect(container.textContent).toContain(
      "Verification code has been sent to:",
    );
    expect(container.textContent).toContain("Verify your email");
    expect(container.textContent).toContain(
      "Can't find the email? Please check your spam or junk folder.",
    );

    const emailEl = container.querySelector('p[title="user@example.com"]');
    expect(emailEl).not.toBeNull();
    expect(emailEl?.className).toContain("whitespace-nowrap");

    const noticeEl = container.querySelector(".text-amber-300");
    expect(noticeEl).not.toBeNull();
    expect(noticeEl?.className).toContain("border-amber-500/30");
  });

  it("renders fallback description and spam notice when email is not provided", () => {
    act(() => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <OtpVerificationPart
            title="Reset password"
            description="Enter the code sent to your email."
            challenge={mockChallenge}
            onVerify={vi.fn()}
            onResend={vi.fn()}
          />
        </I18nextProvider>,
      );
    });

    expect(container.textContent).toContain(
      "Enter the code sent to your email.",
    );
    expect(container.textContent).toContain("Reset password");
    expect(container.textContent).toContain(
      "Can't find the email? Please check your spam or junk folder.",
    );
  });

  it("counts down expiration and resend timers every second without resetting", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        root.render(
          <I18nextProvider i18n={i18n}>
            <OtpVerificationPart
              title="Confirm password change"
              description="Enter code"
              challenge={{
                challengeId: "countdown-challenge",
                expiresIn: 600,
                resendAfter: 60,
              }}
              onVerify={vi.fn()}
              onResend={vi.fn()}
            />
          </I18nextProvider>,
        );
      });

      expect(container.textContent).toContain("Code expires in 10:00");
      expect(container.textContent).toContain("Resend available in 60s");

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(container.textContent).toContain("Code expires in 9:57");
      expect(container.textContent).toContain("Resend available in 57s");
    } finally {
      vi.useRealTimers();
    }
  });
});
