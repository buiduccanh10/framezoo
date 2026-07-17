import React from "react";

export interface ProgressProps {
  progress: number;
  className?: string;
}

export function Progress({ progress, className = "" }: ProgressProps) {
  return (
    <div
      className={`w-full bg-video-bg rounded-full h-1.5 overflow-hidden ${className}`}
    >
      <div
        className="bg-brand h-1.5 rounded-full transition-all duration-300 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}
