import { Composition } from "remotion";
import { FramezooAd } from "./FramezooAd";
import { FramezooUpdate } from "./FramezooUpdate";

export const MyComposition = () => {
  return (
    <>
      <Composition
        id="FramezooUpdate"
        component={FramezooUpdate}
        durationInFrames={480}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="FramezooAdTikTok"
        component={FramezooAd}
        durationInFrames={2820}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
