import classNames from "classnames";

import type { StremioResource } from "@/desktop/addons/types";

const badgeColors: Record<string, string> = {
  stream: "bg-purple-500/20 text-purple-300",
  catalog: "bg-blue-500/20 text-blue-300",
  meta: "bg-yellow-500/20 text-yellow-300",
  subtitles: "bg-green-500/20 text-green-300",
};

export function AddonResourceBadges({
  resources,
  className,
}: {
  resources?: StremioResource[];
  className?: string;
}) {
  const resourceNames = resources
    ?.map((resource) =>
      typeof resource === "string" ? resource : (resource?.name ?? ""),
    )
    .filter(Boolean);

  if (!resourceNames?.length) return null;

  return (
    <div className={classNames("flex flex-wrap gap-1", className)}>
      {resourceNames.map((resource) => (
        <span
          key={resource}
          className={classNames(
            "rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
            badgeColors[resource] ??
              "bg-dropdown-altBackground text-dropdown-text",
          )}
        >
          {resource}
        </span>
      ))}
    </div>
  );
}
