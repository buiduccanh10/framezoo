import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { colors } from "../ui";

export const DiscoverScene: React.FC = () => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [0, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const focus = interpolate(frame, [18, 58, 150], [0, 1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#050505", overflow: "hidden" }}>
      <Img
        src={staticFile("prod-discover-addons.png")}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: reveal,
          scale: interpolate(frame, [0, 150], [1.04, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, rgba(5,5,5,.88) 0%, rgba(5,5,5,.58) 29%, transparent 56%), linear-gradient(0deg, rgba(5,5,5,.78) 0%, transparent 28%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 82,
          top: 82,
          width: 660,
          opacity: reveal,
          translate: `${interpolate(frame, [0, 22], [30, 0], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px 0`,
        }}
      >
        <div style={{ color: colors.cyan, fontSize: 16, fontWeight: 800, letterSpacing: 2.4 }}>01 · DISCOVER</div>
        <h2 style={{ margin: "18px 0 0", color: "#fff", fontSize: 54, lineHeight: 1.02, letterSpacing: -2.2 }}>
          Category native,
          <br />
          <span style={{ color: colors.cyan }}>ngay trong Discover.</span>
        </h2>
        <p style={{ margin: "20px 0 0", color: "#e7e7e7", fontSize: 22, lineHeight: 1.35 }}>
          Catalog thật của Framezoo, đúng layout Discover prod.
        </p>
      </div>
      <div
        style={{
          position: "absolute",
          left: 66,
          right: 66,
          top: 306,
          height: 452,
          border: `3px solid ${colors.cyan}`,
          borderRadius: 24,
          boxShadow: `0 0 0 999px rgba(0,0,0,${0.06 + focus * 0.12}), 0 0 36px ${colors.cyan}66`,
          opacity: focus,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 92,
          bottom: 50,
          padding: "12px 18px",
          borderRadius: 12,
          backgroundColor: "rgba(0,0,0,.78)",
          color: "#fff",
          fontSize: 21,
          fontWeight: 800,
          opacity: interpolate(frame, [62, 82], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        Phim Hành Động · catalog native
      </div>
    </AbsoluteFill>
  );
};
