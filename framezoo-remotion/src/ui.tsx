import { Img, staticFile } from "remotion";

export const colors = {
  bg: "#080b12",
  panel: "#101621",
  panelRaised: "#171f2d",
  line: "rgba(223, 233, 255, .11)",
  muted: "#8d98aa",
  text: "#f2f6ff",
  cyan: "#67d7ff",
  amber: "#ffbe5c",
  coral: "#ff766f",
  violet: "#b791ff",
};

export const Logo = ({ width = 160 }: { width?: number }) => (
  <Img src={staticFile("framezoo-logo.svg")} style={{ width, height: "auto" }} />
);

export const Pill = ({
  children,
  tone = "cyan",
  compact = false,
}: {
  children: React.ReactNode;
  tone?: "cyan" | "amber" | "violet" | "muted";
  compact?: boolean;
}) => {
  const color =
    tone === "amber"
      ? colors.amber
      : tone === "violet"
        ? colors.violet
        : tone === "muted"
          ? colors.muted
          : colors.cyan;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        border: `1px solid ${color}55`,
        borderRadius: 999,
        color,
        backgroundColor: `${color}12`,
        padding: compact ? "6px 10px" : "9px 14px",
        fontSize: compact ? 14 : 16,
        fontWeight: 700,
        letterSpacing: 0.2,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: color }} />
      {children}
    </span>
  );
};

export const Dot = ({ color = colors.amber, size = 8 }: { color?: string; size?: number }) => (
  <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", backgroundColor: color, boxShadow: `0 0 18px ${color}` }} />
);

