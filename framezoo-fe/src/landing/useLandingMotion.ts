import { type RefObject, useEffect } from "react";

export function useLandingMotion(shellRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const revealNodes = Array.from(
      shell.querySelectorAll<HTMLElement>(".landing-scroll-reveal"),
    );
    shell.classList.add("is-motion-ready");

    if (typeof IntersectionObserver === "undefined") {
      revealNodes.forEach((node) => node.classList.add("is-visible"));
      return () => shell.classList.remove("is-motion-ready");
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        rootMargin: "0px 0px -10% 0px",
        threshold: 0.16,
      },
    );

    revealNodes.forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      shell.classList.remove("is-motion-ready");
    };
  }, [shellRef]);
}
