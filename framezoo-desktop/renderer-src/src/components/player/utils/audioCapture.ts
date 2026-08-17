type LibMpvAudioRequest = {
  url: string;
  startAt: number;
  duration: number;
  headers?: Record<string, string>;
  requestId?: string;
};

function getElectronApi() {
  return (window as any).electronAPI as
    | {
        extractLibMpvAudio?: (
          request: LibMpvAudioRequest & { requestId: string },
        ) => Promise<Uint8Array>;
        cancelLibMpvAudio?: (requestId: string) => Promise<boolean>;
      }
    | undefined;
}

export async function extractAudioWindow(options: {
  url: string;
  startAt: number;
  duration: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const extract = getElectronApi()?.extractLibMpvAudio;
  if (!extract) {
    throw new Error("libmpv audio extraction is unavailable");
  }

  const requestId = crypto.randomUUID();
  const cancel = getElectronApi()?.cancelLibMpvAudio;
  const onAbort = () => {
    void cancel?.(requestId);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  let audio: Uint8Array;
  try {
    audio = await extract({
      url: options.url,
      startAt: Math.max(0, options.startAt),
      duration: Math.min(60, Math.max(1, options.duration)),
      headers: options.headers,
      requestId,
    });
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
  if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
    throw new Error("libmpv returned an empty audio capture");
  }
  return audio;
}
