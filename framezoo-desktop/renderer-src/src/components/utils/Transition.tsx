import classNames from "classnames";
import {
  CSSProperties,
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
      leave: `transition-[transform,opacity] ${duration}`,
      leaveFrom: "opacity-100 translate-y-0",
      leaveTo: "-translate-y-4 opacity-0",
      enter: `transition-[transform,opacity] ${duration}`,
      enterFrom: "opacity-0 -translate-y-4",
      enterTo: "translate-y-0 opacity-100",
    };
  }

  if (animation === "slide-up") {
    return {
      leave: `transition-[transform,opacity] ${duration}`,
      leaveFrom: "opacity-100 translate-y-0",
      leaveTo: "translate-y-4 opacity-0",
      enter: `transition-[transform,opacity] ${duration}`,
      enterFrom: "opacity-0 translate-y-4",
      enterTo: "translate-y-0 opacity-100",
    };
  }

  if (animation === "slide-full-left") {
    return {
      leave: `transition-[transform] ${duration}`,
      leaveFrom: "translate-x-0",
      leaveTo: "-translate-x-full",
      enter: `transition-[transform] ${duration}`,
      enterFrom: "-translate-x-full",
      enterTo: "translate-x-0",
    };
  }

  if (animation === "slide-full-right") {
    return {
      leave: `transition-[transform] ${duration}`,
      leaveFrom: "translate-x-0",
      leaveTo: "translate-x-full",
      enter: `transition-[transform] ${duration}`,
      enterFrom: "translate-x-full",
      enterTo: "translate-x-0",
    };
  }

  if (animation === "fade") {
    return {
      leave: `transition-[transform,opacity] ${duration}`,
      leaveFrom: "opacity-100",
      leaveTo: "opacity-0",
      enter: `transition-[transform,opacity] ${duration}`,
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
}

const TransitionContext = createContext<TransitionContextValue | null>(null);

type Stage =
  "unmounted" | "enter-start" | "enter-active" | "entered" | "leave-active";

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
  const [stage, setStage] = useState<Stage>(
    effectiveShow ? "entered" : "unmounted",
  );
  const isFirstRender = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (props.animation === "none") {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setMounted(effectiveShow);
      setStage(effectiveShow ? "entered" : "unmounted");
      return;
    }

    if (effectiveShow) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setMounted(true);
      setStage("enter-start");
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setStage("leave-active");
      timerRef.current = setTimeout(() => {
        setMounted(false);
        setStage("unmounted");
        timerRef.current = null;
      }, durationMs);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [effectiveShow, props.animation, durationMs]);

  useIsomorphicLayoutEffect(() => {
    if (stage === "enter-start") {
      if (elRef.current) {
        void elRef.current.offsetHeight;
      }
      setStage("enter-active");
      timerRef.current = setTimeout(() => {
        setStage("entered");
        timerRef.current = null;
      }, durationMs);
    }
  }, [stage, durationMs]);

  const contextValue = useMemo(
    () => ({ show: effectiveShow }),
    [effectiveShow],
  );

  if (!mounted && stage === "unmounted") {
    return null;
  }

  let activeClass = "";
  if (stage === "enter-start") {
    activeClass = `${classes.enter ?? ""} ${classes.enterFrom ?? ""}`;
  } else if (stage === "enter-active") {
    activeClass = `${classes.enter ?? ""} ${classes.enterTo ?? ""}`;
  } else if (stage === "entered") {
    activeClass = classes.enterTo ?? "";
  } else if (stage === "leave-active") {
    activeClass = `${classes.leave ?? ""} ${classes.leaveTo ?? ""}`;
  }

  return (
    <TransitionContext.Provider value={contextValue}>
      <div
        ref={elRef}
        className={classNames(props.className, activeClass)}
        style={props.style}
      >
        {props.children}
      </div>
    </TransitionContext.Provider>
  );
}
