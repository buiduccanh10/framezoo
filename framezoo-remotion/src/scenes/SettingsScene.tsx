import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { colors } from "../ui";

export const SettingsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [0, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const drag = interpolate(frame, [52, 105], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#050505", overflow: "hidden" }}>
      <Img
        src={staticFile("prod-settings-full.png")}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: reveal,
          scale: interpolate(frame, [0, 150], [1.03, 1], {
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
          background: "linear-gradient(90deg, rgba(5,5,5,.86) 0%, rgba(5,5,5,.62) 30%, transparent 58%), linear-gradient(0deg, rgba(5,5,5,.58), transparent 32%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 82,
          top: 82,
          width: 700,
          opacity: reveal,
          translate: `${interpolate(frame, [0, 22], [30, 0], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px 0`,
        }}
      >
        <div style={{ color: colors.amber, fontSize: 16, fontWeight: 800, letterSpacing: 2.4 }}>02 · SETTINGS</div>
        <h2 style={{ margin: "18px 0 0", color: "#fff", fontSize: 54, lineHeight: 1.02, letterSpacing: -2.2 }}>
          Bạn chọn thứ tự.
          <br />
          <span style={{ color: colors.amber }}>Framezoo nhớ lựa chọn.</span>
        </h2>
        <p style={{ margin: "20px 0 0", color: "#e7e7e7", fontSize: 22, lineHeight: 1.35 }}>
          Kéo thả category trong Cài đặt — bao gồm cả Addons.
        </p>
      </div>
      <div
        style={{
          position: "absolute",
          left: 1110,
          top: 692,
          width: 748,
          height: 340,
          border: `3px solid ${colors.amber}`,
          borderRadius: 22,
          boxShadow: `0 0 0 999px rgba(0,0,0,${0.05 + drag * 0.12}), 0 0 34px ${colors.amber}66`,
          opacity: interpolate(frame, [24, 50], [0, 1], { extrapolateRight: "clamp" }),
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 1372,
          top: interpolate(frame, [52, 105], [885, 760], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }),
          width: 0,
          height: 0,
          borderTop: "18px solid transparent",
          borderBottom: "18px solid transparent",
          borderLeft: `28px solid ${colors.amber}`,
          rotate: "-16deg",
          filter: "drop-shadow(0 4px 5px #000)",
          opacity: interpolate(frame, [44, 60], [0, 1], { extrapolateRight: "clamp" }),
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 86,
          bottom: 48,
          padding: "12px 18px",
          borderRadius: 12,
          backgroundColor: "rgba(0,0,0,.78)",
          color: colors.amber,
          fontSize: 21,
          fontWeight: 800,
          opacity: interpolate(frame, [76, 94], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        KÉO · THẢ · SẮP XẾP
      </div>
    </AbsoluteFill>
  );
};
