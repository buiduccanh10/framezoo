import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { colors, Dot, Logo, Pill } from "../ui";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 45%, #254761 0%, transparent 42%), radial-gradient(circle at 50% 90%, #3d2a42 0%, transparent 34%)", opacity: 0.62 }} />
      {[0, 1, 2].map((index) => <div key={index} style={{ position: "absolute", width: 500 + index * 190, height: 500 + index * 190, border: `1px solid ${index === 1 ? colors.cyan : colors.amber}22`, borderRadius: "50%", opacity: interpolate(frame, [0, 28], [0, 1], { extrapolateRight: "clamp" }), scale: interpolate(frame, [0, 42], [0.7, 1], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }) }} />)}
      <div style={{ zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", opacity: interpolate(frame, [0, 26], [0, 1], { extrapolateRight: "clamp" }), translate: `0px ${interpolate(frame, [0, 26], [28, 0], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}` }}>
        <Logo width={220} />
        <div style={{ marginTop: 42, color: colors.text, fontSize: 72, lineHeight: 0.98, fontWeight: 850, letterSpacing: -3 }}>Khám phá theo<br /><span style={{ color: colors.cyan }}>cách bạn xem.</span></div>
        <div style={{ color: colors.muted, fontSize: 22, marginTop: 25 }}>Addons trong Discover · Thứ tự hiển thị do bạn chọn</div>
        <div style={{ display: "flex", gap: 12, marginTop: 33 }}><Pill tone="amber">Cập nhật Framezoo</Pill><Pill tone="muted">v2.0.15</Pill></div>
      </div>
      <div style={{ position: "absolute", left: 130, top: 172, opacity: interpolate(frame, [20, 40], [0, 1], { extrapolateRight: "clamp" }) }}><Dot color={colors.amber} size={12} /></div>
      <div style={{ position: "absolute", right: 170, bottom: 200, opacity: interpolate(frame, [12, 36], [0, 1], { extrapolateRight: "clamp" }) }}><Dot color={colors.cyan} size={8} /></div>
      <div style={{ position: "absolute", bottom: 70, color: "#7e8b9c", fontSize: 13, letterSpacing: 2.4, textTransform: "uppercase", opacity: interpolate(frame, [30, 50], [0, 1], { extrapolateRight: "clamp" }) }}>Find your next favorite</div>
    </AbsoluteFill>
  );
};

