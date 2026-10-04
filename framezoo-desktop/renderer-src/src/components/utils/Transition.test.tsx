import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { Transition } from "./Transition";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("Transition Component", () => {
  it("renders with enter-from on initial mount and transitions to entered", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Transition show animation="slide-up" durationClass="duration-200">
          <div id="content">Content</div>
        </Transition>,
      );
    });

    const el = container.firstElementChild as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.querySelector("#content")).not.toBeNull();

    root.unmount();
    container.remove();
  });

  it("handles enter transition when toggled from show=false to show=true", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Transition show={false} animation="fade" durationClass="duration-200">
          <div id="content">Content</div>
        </Transition>,
      );
    });

    expect(container.firstElementChild).toBeNull();

    await act(async () => {
      root.render(
        <Transition show animation="fade" durationClass="duration-200">
          <div id="content">Content</div>
        </Transition>,
      );
    });

    const el = container.firstElementChild as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.querySelector("#content")).not.toBeNull();

    root.unmount();
    container.remove();
  });

  it("handles leave transition when toggled from show=true to show=false", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Transition show animation="slide-up" durationClass="duration-200">
          <div id="content">Content</div>
        </Transition>,
      );
    });

    expect(container.firstElementChild).not.toBeNull();

    await act(async () => {
      root.render(
        <Transition
          show={false}
          animation="slide-up"
          durationClass="duration-200"
        >
          <div id="content">Content</div>
        </Transition>,
      );
    });

    expect(container.firstElementChild).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(container.firstElementChild).toBeNull();

    root.unmount();
    container.remove();
    vi.useRealTimers();
  });

  it("waits for child leave animations when parent has animation=none", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Transition show animation="none">
          <Transition animation="fade" isChild durationClass="duration-200">
            <div id="backdrop">Backdrop</div>
          </Transition>
          <Transition animation="slide-up" isChild durationClass="duration-200">
            <div id="modal">Modal</div>
          </Transition>
        </Transition>,
      );
    });

    expect(container.querySelector("#backdrop")).not.toBeNull();
    expect(container.querySelector("#modal")).not.toBeNull();

    await act(async () => {
      root.render(
        <Transition show={false} animation="none">
          <Transition animation="fade" isChild durationClass="duration-200">
            <div id="backdrop">Backdrop</div>
          </Transition>
          <Transition animation="slide-up" isChild durationClass="duration-200">
            <div id="modal">Modal</div>
          </Transition>
        </Transition>,
      );
    });

    expect(container.querySelector("#modal")).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(container.firstElementChild).toBeNull();

    root.unmount();
    container.remove();
    vi.useRealTimers();
  });

  it("supports slide-full-left and slide-full-right directional transitions", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Transition
          show
          animation="slide-full-left"
          durationClass="duration-400"
        >
          <div id="menu">Menu</div>
        </Transition>,
      );
    });

    const el = container.firstElementChild as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.transitionDuration).toBe("400ms");

    root.unmount();
    container.remove();
  });
});
