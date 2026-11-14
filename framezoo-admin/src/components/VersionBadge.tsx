import { Tag } from "lucide-react";

export function VersionBadge({ version }: { version: string | null }) {
  if (!version) {
    return <span className="version-badge is-unknown">Chưa rõ</span>;
  }
  const label = version.startsWith("v") ? version : `v${version}`;
  return (
    <span className="version-badge">
      <Tag size={11} aria-hidden="true" />
      {label}
    </span>
  );
}
