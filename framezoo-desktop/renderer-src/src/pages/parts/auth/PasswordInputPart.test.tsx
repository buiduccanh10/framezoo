/** @vitest-environment jsdom */
import i18next from "i18next";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import enCopy from "@/assets/locales/en.json";

import { PasswordInputPart } from "./PasswordInputPart";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/auth/useBackendUrl", () => ({
  useBackendUrl: () => "https://example.com",
}));
vi.mock("@/backend/accounts/crypto", () => ({
  isPasskeySupported: () => true,
  createPasskey: vi.fn(),
}));
vi.mock("@/backend/accounts/user", () => ({
  checkEmailExists: vi.fn(),
  checkNicknameExists: vi.fn(),
}));

describe("PasswordInputPart legal consent", () => {
  const i18n = i18next.createInstance();
  const container = document.createElement("div");
  const root = createRoot(container);

  beforeAll(async () => {
    await i18n.init({ lng: "en", resources: { en: { translation: enCopy } } });
  });

  afterEach(() => {
    act(() => root.render(<></>));
  });

  it("blocks both registration paths until the checkbox is checked; leaves login unchanged", () => {
    act(() =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <PasswordInputPart onNext={vi.fn()} />
        </I18nextProvider>,
      ),
    );
    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].filter(
      (button) =>
        button.textContent?.includes(enCopy.auth.generate.usePasskeyInstead) ||
        button.textContent?.includes(enCopy.auth.register.information.next),
    );
    expect(checkbox.checked).toBe(false);
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(
      container.querySelectorAll('a[href^="https://framezoo.top/legal/"]'),
    ).toHaveLength(2);
    expect(
      container.querySelector('a[href$="/legal/terms"]')?.textContent,
    ).toBe("Terms of Service");
    expect(
      container.querySelector('a[href$="/legal/privacy"]')?.textContent,
    ).toBe("Privacy Policy");

    act(() => checkbox.click());
    expect(buttons.every((button) => !button.disabled)).toBe(true);
    act(() => checkbox.click());
    expect(buttons.every((button) => button.disabled)).toBe(true);

    act(() =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <PasswordInputPart forLogin onNext={vi.fn()} />
        </I18nextProvider>,
      ),
    );
    expect(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(false);
  });
});
