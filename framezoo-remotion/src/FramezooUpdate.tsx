import { AbsoluteFill, Sequence } from "remotion";
import { DiscoverScene } from "./scenes/DiscoverScene";
import { Intro } from "./scenes/Intro";
import { Outro } from "./scenes/Outro";
import { SettingsScene } from "./scenes/SettingsScene";

export const FramezooUpdate: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#080b12", fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
    <Sequence durationInFrames={90} name="Intro"><Intro /></Sequence>
    <Sequence from={90} durationInFrames={150} name="Discover"><DiscoverScene /></Sequence>
    <Sequence from={240} durationInFrames={150} name="Settings"><SettingsScene /></Sequence>
    <Sequence from={390} durationInFrames={90} name="Outro"><Outro /></Sequence>
  </AbsoluteFill>
);

