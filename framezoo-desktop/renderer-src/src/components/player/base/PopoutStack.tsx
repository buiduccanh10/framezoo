import { ReactNode } from "react";

export function PopoutStack(props: {
  children: ReactNode;
  controlsShown: boolean;
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-[60] flex flex-col items-center gap-2 transition-[top] duration-200 ${props.controlsShown ? "top-18" : "top-4"}`}
    >
      {props.children}
    </div>
  );
}
