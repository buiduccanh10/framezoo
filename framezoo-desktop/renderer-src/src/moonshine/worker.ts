type WorkerModel = {
  language: string;
  architecture: "tiny" | "base";
  bundled: boolean;
  files: Array<{ name: string; url: string }>;
};

type WorkerRequest =
  | {
      id: number;
      type: "load";
      model: WorkerModel;
    }
  | {
      id: number;
      type: "transcribe";
      language: string;
      architecture: "tiny" | "base";
      model: WorkerModel;
      audio: ArrayBuffer;
      sampleRate: number;
    }
  | { id: number; type: "close" };

const transcribers = new Map<string, Transcriber>();
type Transcriber = {
  transcribe(
    audio: Float32Array,
    options: { sampleRate: number },
  ): { lines: Array<{ startTime: number; duration: number }> };
  close(): void;
};
let runtimePromise: Promise<{
  Transcriber: {
    load(options: {
      files: Record<string, Uint8Array>;
      modelArch: number;
      module: unknown;
    }): Promise<Transcriber>;
  };
  ModelArch: { Tiny: number; Base: number };
  loadMoonshineModule(): Promise<unknown>;
}> | null = null;

function loadRuntime() {
  runtimePromise ??= (async () => {
    const base = new URL("/moonshine/runtime/", self.location.href);
    const [transcriberModule, enumsModule, moduleModule] = await Promise.all([
      import(/* @vite-ignore */ new URL("transcriber.js", base).href),
      import(/* @vite-ignore */ new URL("enums.js", base).href),
      import(/* @vite-ignore */ new URL("module.js", base).href),
    ]);
    return {
      Transcriber: transcriberModule.Transcriber,
      ModelArch: enumsModule.ModelArch,
      loadMoonshineModule: moduleModule.loadMoonshineModule,
    };
  })();
  return runtimePromise;
}

function key(language: string, architecture: string) {
  return `${architecture}:${language}`;
}

async function loadModel(model: WorkerModel) {
  const modelKey = key(model.language, model.architecture);
  if (transcribers.has(modelKey)) return;

  const files = await Promise.all(
    model.files.map(async (file) => {
      const response = await fetch(file.url);
      if (!response.ok) {
        throw new Error(
          `Moonshine model fetch failed: ${response.status} ${file.url}`,
        );
      }
      return [file.name, new Uint8Array(await response.arrayBuffer())] as const;
    }),
  );
  const runtime = await loadRuntime();
  const transcriber = await runtime.Transcriber.load({
    files: Object.fromEntries(files),
    modelArch:
      model.architecture === "base"
        ? runtime.ModelArch.Base
        : runtime.ModelArch.Tiny,
    module: await runtime.loadMoonshineModule(),
  });
  transcribers.set(modelKey, transcriber);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "load") {
      await loadModel(request.model);
      self.postMessage({ id: request.id, type: "ok" });
      return;
    }
    if (request.type === "transcribe") {
      const transcriber = transcribers.get(
        key(request.language, request.architecture),
      );
      if (!transcriber) throw new Error("Moonshine model is not loaded");
      const transcript = transcriber.transcribe(
        new Float32Array(request.audio),
        { sampleRate: request.sampleRate },
      );
      self.postMessage({ id: request.id, type: "transcript", transcript });
      return;
    }
    for (const transcriber of transcribers.values()) transcriber.close();
    transcribers.clear();
    self.postMessage({ id: request.id, type: "ok" });
  } catch (error) {
    self.postMessage({
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
