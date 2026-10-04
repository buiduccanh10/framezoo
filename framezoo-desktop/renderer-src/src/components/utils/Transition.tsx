import classNames from "classnames";
import {
  CSSProperties,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type TransitionAnimations =
  | "slide-down"
  | "slide-full-left"
  | "slide-full-right"
  | "slide-up"
  | "fade"
  | "none";

export interface Props {
  show?: boolean;
  durationClass?: string;
  animation: TransitionAnimations;
  className?: string;
  children?: ReactNode;
  isChild?: boolean;
  style?: CSSProperties;
}

export interface TransitionClasses {
  enter?: string;
  enterFrom?: string;
  enterTo?: string;
  leave?: string;
  leaveFrom?: string;
  leaveTo?: string;
}

function getClasses(
  animation: TransitionAnimations,
  duration: string,
): TransitionClasses {
  if (animation === "slide-down") {
    return {
      leave: `transition-all ease-out ${duration}`,
      leaveFrom: "opacity-100 translate-y-0",
      leaveTo: "-translate-y-4 opacity-0",
      enter: `transition-all ease-out ${duration}`,
      enterFrom: "opacity-0 -translate-y-4",
      enterTo: "translate-y-0 opacity-100",
    };
  }

  if (animation === "slide-up") {
    return {
      leave: `transition-all ease-out ${duration}`,
      leaveFrom: "opacity-100 translate-y-0",
      leaveTo: "translate-y-4 opacity-0",
      enter: `transition-all ease-out ${duration}`,
      enterFrom: "opacity-0 translate-y-4",
      enterTo: "translate-y-0 opacity-100",
    };
  }

  if (animation === "slide-full-left") {
    return {
      leave: `transition-transform ease-out ${duration}`,
      leaveFrom: "translate-x-0",
      leaveTo: "-translate-x-full",
      enter: `transition-transform ease-out ${duration}`,
      enterFrom: "-translate-x-full",
      enterTo: "translate-x-0",
    };
  }

  if (animation === "slide-full-right") {
    return {
      leave: `transition-transform ease-out ${duration}`,
      leaveFrom: "translate-x-0",
      leaveTo: "translate-x-full",
      enter: `transition-transform ease-out ${duration}`,
      enterFrom: "translate-x-full",
      enterTo: "translate-x-0",
    };
  }

  if (animation === "fade") {
    return {
      leave: `transition-opacity ease-out ${duration}`,
      leaveFrom: "opacity-100",
      leaveTo: "opacity-0",
      enter: `transition-opacity ease-out ${duration}`,
      enterFrom: "opacity-0",
      enterTo: "opacity-100",
    };
  }

  return {};
}

function parseDuration(durationClass?: string): number {
  if (!durationClass) return 200;
  const match = durationClass.match(/\d+/);
  return match ? parseInt(match[0], 10) : 200;
}

interface TransitionContextValue {
  show: boolean;
  onChildLeaveStart?: () => void;
  onChildLeaveEnd?: () => void;
}

const TransitionContext = createContext<TransitionContextValue | null>(null);

type Stage =
  | "unmounted"
  | "enter-from"
  | "enter-to"
  | "entered"
  | "leave-from"
  | "leave-to";

export function Transition(props: Props) {
  const context = useContext(TransitionContext);
  const effectiveShow =
    props.show !== undefined
      ? Boolean(props.show)
      : props.isChild && context !== null
        ? context.show
        : Boolean(props.show ?? true);

  const durationClass = props.durationClass ?? "duration-200";
  const durationMs = parseDuration(durationClass);
  const classes = useMemo(
    () => getClasses(props.animation, durationClass),
    [props.animation, durationClass],
  );

  const [mounted, setMounted] = useState(effectiveShow);
  const [stage, setStage] = useState<Stage>(() => {
    if (!effectiveShow) return "unmounted";
    return props.animation === "none" ? "entered" : "enter-from";
  });

  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef1 = useRef<number | null>(null);
  const rafRef2 = useRef<number | null>(null);
  const elRef = useRef<HTMLDivElement>(null);
  const isLeavingParent = useRef(false);

  // Active child leave tracking for parent coordination
  const leavingChildrenCountRef = useRef(0);
  const [childrenLeaving, setChildrenLeaving] = useState(false);

  const onChildLeaveStart = useCallback(() => {
    leavingChildrenCountRef.current += 1;
    setChildrenLeaving(true);
  }, []);

  const onChildLeaveEnd = useCallback(() => {
    leavingChildrenCountRef.current = Math.max(
      0,
      leavingChildrenCountRef.current - 1,
    );
    if (leavingChildrenCountRef.current === 0) {
      setChildrenLeaving(false);
    }
  }, []);

  const clearPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef1.current !== null) {
      cancelAnimationFrame(rafRef1.current);
      rafRef1.current = null;
    }
    if (rafRef2.current !== null) {
      cancelAnimationFrame(rafRef2.current);
      rafRef2.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearPending();
      if (isLeavingParent.current && context?.onChildLeaveEnd) {
        context.onChildLeaveEnd();
      }
    };
  }, [clearPending, context]);

  const isInitialMount = useRef(true);

  useEffect(() => {
    clearPending();

    if (effectiveShow) {
      if (isLeavingParent.current && context?.onChildLeaveEnd) {
        context.onChildLeaveEnd();
        isLeavingParent.current = false;
      }

      setMounted(true);

      if (props.animation === "none") {
        setStage("entered");
        return;
      }

      if (!isInitialMount.current && stageRef.current === "entered") {
        return;
      }
      isInitialMount.current = false;

      setStage("enter-from");

      rafRef1.current = requestAnimationFrame(() => {
        if (elRef.current) {
          void elRef.current.offsetHeight;
        }
        rafRef2.current = requestAnimationFrame(() => {
          setStage("enter-to");
          timerRef.current = setTimeout(() => {
            setStage("entered");
            timerRef.current = null;
          }, durationMs);
        });
      });
    } else {
      isInitialMount.current = false;

      if (!mountedRef.current && stageRef.current === "unmounted") {
        return;
      }

      if (props.animation === "none") {
        return;
      }

      if (!isLeavingParent.current && context?.onChildLeaveStart) {
        isLeavingParent.current = true;
        context.onChildLeaveStart();
      }

      setStage("leave-from");

      rafRef1.current = requestAnimationFrame(() => {
        if (elRef.current) {
          void elRef.current.offsetHeight;
        }
        rafRef2.current = requestAnimationFrame(() => {
          setStage("leave-to");
          timerRef.current = setTimeout(() => {
            setMounted(false);
            setStage("unmounted");
            timerRef.current = null;
            if (isLeavingParent.current && context?.onChildLeaveEnd) {
              context.onChildLeaveEnd();
              isLeavingParent.current = false;
            }
          }, durationMs);
        });
      });
    }

    return () => {
      clearPending();
    };
  }, [effectiveShow, props.animation, durationMs, clearPending, context]);

  // Root coordination: when effectiveShow is false and animation is "none", wait for child transitions
  useEffect(() => {
    if (!effectiveShow && props.animation === "none") {
      if (childrenLeaving) {
        return;
      }

      const checkTimer = setTimeout(() => {
        if (leavingChildrenCountRef.current === 0) {
          setMounted(false);
          setStage("unmounted");
        }
      }, 50);

      const safetyTimer = setTimeout(
        () => {
          setMounted(false);
          setStage("unmounted");
        },
        Math.max(durationMs, 1000),
      );

      return () => {
        clearTimeout(checkTimer);
        clearTimeout(safetyTimer);
      };
    }
  }, [effectiveShow, props.animation, childrenLeaving, durationMs]);

  const contextValue = useMemo(
    () => ({
      show: effectiveShow,
      onChildLeaveStart,
      onChildLeaveEnd,
    }),
    [effectiveShow, onChildLeaveStart, onChildLeaveEnd],
  );

  if (!mounted && stage === "unmounted") {
    return null;
  }

  let activeClass = "";
  if (stage === "enter-from") {
    activeClass = `${classes.enter ?? ""} ${classes.enterFrom ?? ""}`;
  } else if (stage === "enter-to") {
    activeClass = `${classes.enter ?? ""} ${classes.enterTo ?? ""}`;
  } else if (stage === "entered") {
    activeClass = classes.enterTo ?? "";
  } else if (stage === "leave-from") {
    activeClass = `${classes.leave ?? ""} ${classes.leaveFrom ?? ""}`;
  } else if (stage === "leave-to") {
    activeClass = `${classes.leave ?? ""} ${classes.leaveTo ?? ""}`;
  }

  const animStyle =
    props.animation === "none" || stage === "entered" || stage === "unmounted"
      ? props.style
      : {
          ...props.style,
          transitionDuration: `${durationMs}ms`,
        };

  return (
    <TransitionContext.Provider value={contextValue}>
      <div
        ref={elRef}
        className={classNames(props.className, activeClass)}
        style={animStyle}
      >
        {props.children}
      </div>
    </TransitionContext.Provider>
  );
}
