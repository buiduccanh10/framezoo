import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, Dot, Logo, Pill } from "../ui";

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 66% 42%, #263c5c 0%, transparent 36%), radial-gradient(circle at 22% 84%, #2a1b3d 0%, transparent 32%)", opacity: 0.65 }} />
      <div style={{ position: "absolute", width: 920, height: 920, border: "1px solid #ffffff10", borderRadius: "50%", right: -220, top: -170, scale: interpolate(frame, [0, 75], [0.88, 1], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }) }} />
      <div style={{ position: "absolute", width: 560, height: 560, border: `1px solid ${colors.cyan}24`, borderRadius: "50%", right: -10, top: 190, rotate: `${interpolate(frame, [0, 90], [0, 18], { extrapolateRight: "clamp" })}deg` }} />
      <div style={{ position: "absolute", top: 82, left: 102, opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" }) }}><Logo width={168} /></div>
      <div style={{ position: "absolute", left: 104, top: 276, width: 1000 }}>
        <div style={{ color: colors.amber, fontSize: 18, fontWeight: 800, letterSpacing: 3.5, textTransform: "uppercase", opacity: interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" }) }}>
          BẢN CẬP NHẬT MỚI · 2.0.15
        </div>
        <h1 style={{ margin: "22px 0 0", color: colors.text, fontSize: 98, lineHeight: 0.98, letterSpacing: -4, fontWeight: 850, maxWidth: 940, opacity: interpolate(frame, [9, 34], [0, 1], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), translate: `${interpolate(frame, [9, 34], [42, 0], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px 0` }}>
          Khám phá.<br /><span style={{ color: colors.cyan }}>Theo cách của bạn.</span>
        </h1>
        <p style={{ color: "#bdc7d8", fontSize: 27, lineHeight: 1.35, maxWidth: 660, marginTop: 30, opacity: interpolate(frame, [28, 52], [0, 1], { extrapolateRight: "clamp" }) }}>
          Framezoo đưa catalog từ addons vào Discover — rồi để bạn chọn thứ tự hiển thị.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 38, opacity: interpolate(frame, [43, 65], [0, 1], { extrapolateRight: "clamp" }), translate: `${interpolate(frame, [43, 65], [20, 0], { extrapolateRight: "clamp" })}px 0` }}>
          <Pill tone="cyan">Addon catalogs</Pill>
          <Pill tone="amber">Drag & drop</Pill>
        </div>
      </div>
      <div style={{ position: "absolute", right: 212, top: 284, width: 350, height: 350, borderRadius: 110, rotate: "17deg", background: "linear-gradient(145deg, #ffbf5b, #f06769 48%, #6047b7)", boxShadow: "0 36px 90px #f16a5570", opacity: interpolate(frame, [12, 42], [0, 0.9], { extrapolateRight: "clamp" }), scale: interpolate(frame, [12, 42], [0.72, 1], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }) }}>
        <div style={{ position: "absolute", inset: 20, borderRadius: 90, border: "1px solid #ffffff55" }} />
        <div style={{ position: "absolute", left: 58, bottom: 54, color: "#fff", fontSize: 39, fontWeight: 900, letterSpacing: -2 }}>DISCOVER</div>
      </div>
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} style={{ position: "absolute", right: 104 + index * 78, top: 182 + (index % 2) * 470, opacity: interpolate(frame, [18 + index * 4, 42 + index * 4], [0, 1], { extrapolateRight: "clamp" }), translate: `${interpolate(frame, [18 + index * 4, 42 + index * 4], [16, 0], { extrapolateRight: "clamp" })}px 0` }}><Dot color={index % 2 ? colors.cyan : colors.amber} size={index % 2 ? 7 : 10} /></div>
      ))}
      <div style={{ position: "absolute", bottom: 80, right: 106, color: "#93a1b5", fontSize: 15, letterSpacing: 1.3, opacity: interpolate(frame, [55, 75], [0, 1], { extrapolateRight: "clamp" }) }}>
        MỘT KHÔNG GIAN · NHIỀU CÁCH XEM
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: `linear-gradient(90deg, ${colors.amber}, ${colors.cyan})`, transform: `scaleX(${interpolate(frame, [0, fps * 3], [0, 1], { extrapolateRight: "clamp" })})`, transformOrigin: "left" }} />
    </AbsoluteFill>
  );
};

