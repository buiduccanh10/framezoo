import { Link } from "react-router-dom";

import { BrandPill } from "@/components/layout/BrandPill";
import { WindowControls } from "@/components/layout/WindowControls";
import { BlurEllipsis } from "@/pages/layouts/SubPageLayout";

export function MinimalPageLayout(props: { children: React.ReactNode }) {
  return (
    <div
      className="bg-background-main min-h-screen relative"
      style={{
        backgroundImage:
          "linear-gradient(to bottom, var(--tw-gradient-from), var(--tw-gradient-to) 800px)",
      }}
    >
      <BlurEllipsis />
      {/* Top Header */}
      <div className="fixed px-7 py-5 left-0 top-0 z-20">
        <Link
          className="block tabbable rounded-full text-xs ssm:text-base"
          to="/"
        >
          <BrandPill clickable />
        </Link>
      </div>
      <div className="fixed px-7 py-5 right-0 top-0 z-20 pointer-events-auto">
        <WindowControls />
      </div>
      <div className="min-h-screen relative z-10">{props.children}</div>
    </div>
  );
}
