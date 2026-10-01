import classNames from "classnames";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  Transition,
  TransitionAnimations,
} from "@/components/utils/Transition";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useInternalOverlayRouter } from "@/hooks/useOverlayRouter";
import { useOverlayStore } from "@/stores/overlay/store";

interface Props {
  id: string;
  path: string;
  children?: ReactNode;
  className?: string;
  height: number;
  width: number;
  fullWidth?: boolean;
  autoHeight?: boolean;
}

export function OverlayPage(props: Props) {
  const router = useInternalOverlayRouter(props.id);
  const backwards = router.showBackwardsTransition(props.path);
  const show = router.isCurrentPage(props.path);
  const registerRoute = useOverlayStore((s) => s.registerRoute);
  const path = useMemo(() => router.makePath(props.path), [props.path, router]);
  const { isMobile } = useIsMobile();
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.autoHeight || !show) return;
    const el = contentRef.current;
    if (!el) return;

    const updateHeight = () => {
      const height = Math.ceil(el.offsetHeight);
      if (height > 0) {
        setMeasuredHeight(height);
      }
    };

    updateHeight();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        updateHeight();
      });
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, [props.autoHeight, show]);

  const effectiveHeight = props.autoHeight
    ? (measuredHeight ?? props.height)
    : props.height;

  useEffect(() => {
    registerRoute({
      id: path,
      width: props.fullWidth ? window.innerWidth - 60 : props.width,
      height: effectiveHeight,
    });
  }, [effectiveHeight, props.width, props.fullWidth, path, registerRoute]);

  const width = !isMobile
    ? props.fullWidth
      ? "calc(100vw - 60px)"
      : `${props.width}px`
    : "100%";
  let animation: TransitionAnimations = "none";
  if (backwards === "yes" || backwards === "no")
    animation = backwards === "yes" ? "slide-full-left" : "slide-full-right";

  return (
    <Transition
      animation={animation}
      className="absolute inset-0"
      durationClass="duration-[400ms]"
      show={show}
    >
      <div
        ref={contentRef}
        className={classNames([
          props.autoHeight ? "h-fit" : "grid grid-rows-1 max-h-full",
          props.className,
          props.fullWidth ? "max-w-none" : "",
        ])}
        style={{
          height: props.autoHeight
            ? undefined
            : props.height
              ? `${props.height}px`
              : undefined,
          width: props.width ? width : undefined,
        }}
      >
        {props.children}
      </div>
    </Transition>
  );
}
