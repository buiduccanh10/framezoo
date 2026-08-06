type LibMpvAudioRequest = {
  url: string;
  startAt: number;
  duration: number;
  headers?: Record<string, string>;
};

function getElectronApi() {
  return (window as any).electronAPI as
    | {
        extractLibMpvAudio?: (
          request: LibMpvAudioRequest,
        ) => Promise<Uint8Array>;
      }
    | undefined;
}

export async function extractAudioWindow(options: {
  url: string;
  startAt: number;
  duration: number;
  headers?: Record<string, string>;
}): Promise<Uint8Array> {
  const extract = getElectronApi()?.extractLibMpvAudio;
  if (!extract) {
    throw new Error("libmpv audio extraction is unavailable");
  }

  const audio = await extract({
    url: options.url,
    startAt: Math.max(0, options.startAt),
    duration: Math.min(60, Math.max(1, options.duration)),
    headers: options.headers,
  });
  if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
    throw new Error("libmpv returned an empty audio capture");
  }
  return audio;
}
