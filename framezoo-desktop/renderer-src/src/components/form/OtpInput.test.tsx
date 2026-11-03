import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OtpInput } from "./OtpInput";

describe("OtpInput", () => {
  let root: Root;
  let container: HTMLDivElement;
  let value = "";

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    value = "";
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("fills all digits when a verification code is pasted", () => {
    act(() => {
      root.render(
        createElement(OtpInput, {
          value,
          onChange: (next) => {
            value = next;
            act(() => {
              root.render(
                createElement(OtpInput, {
                  value,
                  onChange: (updated) => (value = updated),
                }),
              );
            });
          },
        }),
      );
    });

    const input = container.querySelector("input");
    expect(input).not.toBeNull();
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "12a3456" },
    });

    act(() => input?.dispatchEvent(event));
    expect(value).toBe("123456");
  });

  it("extracts 6 digits when pasting text like 'Sao chép mã: 746837'", () => {
    act(() => {
      root.render(
        createElement(OtpInput, {
          value,
          onChange: (next) => {
            value = next;
          },
        }),
      );
    });

    const input = container.querySelector("input");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "Sao chép mã: 746837" },
    });

    act(() => input?.dispatchEvent(event));
    expect(value).toBe("746837");
  });
});
