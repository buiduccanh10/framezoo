import React from "react";

export interface ProgressProps {
  progress: number;
  className?: string;
  indicatorClassName?: string;
}

export function Progress({
  progress,
  className = "",
  indicatorClassName = "bg-white",
}: ProgressProps) {
  return (
    <div
      className={`w-full bg-video-bg rounded-full h-1.5 overflow-hidden ${className}`}
    >
      <div
        className={`h-1.5 rounded-full transition-all duration-300 ease-out ${indicatorClassName}`}
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}
