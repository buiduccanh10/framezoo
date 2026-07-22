import ffmpegStatic from "ffmpeg-static";
// @ts-expect-error ffprobe-static lacks declaration file
import ffprobeStatic from "ffprobe-static";

function fixAsarPath(binPath: string | null | undefined): string | null {
  if (!binPath) return null;
  return binPath.replace("app.asar", "app.asar.unpacked");
}

export function getFfmpegPaths(): {
  ffmpegPath: string | null;
  ffprobePath: string | null;
} {
  const envFfmpeg = process.env.FFMPEG_PATH;
  const envFfprobe = process.env.FFPROBE_PATH;

  const ffmpegPath = envFfmpeg ? envFfmpeg : fixAsarPath(ffmpegStatic);
  const ffprobePath = envFfprobe
    ? envFfprobe
    : fixAsarPath(ffprobeStatic?.path);

  return { ffmpegPath, ffprobePath };
}

export function setupFfmpegEnv(): void {
  const { ffmpegPath, ffprobePath } = getFfmpegPaths();
  if (ffmpegPath && !process.env.FFMPEG_PATH) {
    process.env.FFMPEG_PATH = ffmpegPath;
  }
  if (ffprobePath && !process.env.FFPROBE_PATH) {
    process.env.FFPROBE_PATH = ffprobePath;
  }
}
