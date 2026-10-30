import { Composition } from "remotion";
import { FramezooUpdate } from "./FramezooUpdate";

export const MyComposition = () => {
  return (
    <Composition
      id="FramezooUpdate"
      component={FramezooUpdate}
      durationInFrames={480}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
