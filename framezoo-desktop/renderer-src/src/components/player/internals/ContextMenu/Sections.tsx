import classNames from "classnames";
import { useEffect, useRef } from "react";

export function SectionTitle(props: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={classNames(
        "uppercase font-bold text-type-secondary text-xs pl-1 pb-2.5 border-b border-type-secondary/40",
        props.children ? "pt-8" : "pt-4",
        props.className,
      )}
    >
      {props.children}
    </h3>
  );
}

export function Section(props: {
  children: React.ReactNode;
  className?: string;
  grid?: boolean;
}) {
  return (
    <div
      className={classNames(
        props.grid ? "grid grid-cols-2 gap-3 pt-6" : "pt-4 space-y-1",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

export function ScrollToActiveSection(props: {
  children: React.ReactNode;
  className?: string;
  loaded?: any;
  behavior?: ScrollBehavior;
  autoScroll?: boolean;
}) {
  const scrollingContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (props.autoScroll === false) return;

    const performScroll = () => {
      const container = scrollingContainer.current;
      if (!container) return;

      const active = container.querySelector<HTMLElement>("[data-active-link]");
      if (!active) return;

      const boxRect = container.getBoundingClientRect();
      const activeLinkRect = active.getBoundingClientRect();
      if (!activeLinkRect || !boxRect || boxRect.height === 0) return;

      const targetTop =
        container.scrollTop +
        (activeLinkRect.top - boxRect.top) -
        (boxRect.height - activeLinkRect.height) / 2;

      container.scrollTo({
        top: Math.max(0, targetTop),
        left: 0,
        behavior: props.behavior ?? "smooth",
      });
    };

    const frameId = requestAnimationFrame(() => {
      performScroll();
    });

    const timerId = setTimeout(() => {
      performScroll();
    }, 100);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
    };
  }, [props.loaded, props.behavior, props.autoScroll]);

  return (
    <div
      ref={scrollingContainer}
      className={classNames("pt-4 space-y-1", props.className)}
    >
      {props.children}
    </div>
  );
}
