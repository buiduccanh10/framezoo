import { checkMoonshineHardware } from "./hardware";
import type {
  MoonshineCatalog,
  MoonshineModelEntry,
  MoonshineStartupState,
} from "./types";

type WorkerResponse =
  | { id: number; type: "ok" }
  | {
      id: number;
      type: "transcript";
      transcript: { lines: Array<{ startTime: number; duration: number }> };
    }
  | { id: number; type: "error"; message: string };

type WorkerModel = {
  language: string;
  architecture: "tiny" | "base";
  bundled: boolean;
  files: Array<{ name: string; url: string }>;
};

type WorkerRequest = {
  id: number;
  type: string;
  [key: string]: unknown;
};

export class MoonshineModelCancelledError extends Error {
  constructor() {
    super("Moonshine model download was cancelled");
    this.name = "MoonshineModelCancelledError";
  }
}

export class MoonshineRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoonshineRuntimeError";
  }
}

export class MoonshineLanguageUnavailableError extends MoonshineRuntimeError {
  readonly language: string;

  constructor(language: string) {
    super(`Moonshine model is unavailable for language "${language}"`);
    this.name = "MoonshineLanguageUnavailableError";
    this.language = language;
  }
}

const MODEL_DOWNLOAD_TIMEOUT_MS = 300_000;
const LOCAL_INFERENCE_TIMEOUT_MIN_MS = 30_000;
const LOCAL_INFERENCE_TIMEOUT_EXTRA_MS = 15_000;
const LOCAL_INFERENCE_TIMEOUT_FACTOR = 2;

let catalogPromise: Promise<MoonshineCatalog> | null = null;
let worker: Worker | null = null;
let nextRequestId = 1;
const activeNativeRequestIds = new Set<string>();
let localDisabledForSession = false;
let startupPromise: Promise<MoonshineStartupState> | null = null;
let startupState: MoonshineStartupState = {
  status: "idle",
  hardware: checkMoonshineHardware(),
  models: {},
};
let modelPromptHandler:
  | ((entry: MoonshineModelEntry) => Promise<boolean>)
  | null = null;
const ISO_639_3_TO_1: Record<string, string> = {
  ara: "ar",
  ces: "cs",
  deu: "de",
  ell: "el",
  eng: "en",
  fas: "fa",
  fin: "fi",
  fra: "fr",
  heb: "he",
  hin: "hi",
  ind: "id",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  nld: "nl",
  nor: "no",
  pol: "pl",
  por: "pt",
  ron: "ro",
  rus: "ru",
  spa: "es",
  swe: "sv",
  tha: "th",
  tur: "tr",
  ukr: "uk",
  vie: "vi",
  zho: "zh",
};

function publishState(next: MoonshineStartupState) {
  startupState = next;
  window.dispatchEvent(
    new CustomEvent("framezoo-moonshine-state", { detail: next }),
  );
}

export function getMoonshineStartupState() {
  return startupState;
}

export function onMoonshineStartupState(
  listener: (state: MoonshineStartupState) => void,
) {
  const handler = (event: Event) =>
    listener((event as CustomEvent<MoonshineStartupState>).detail);
  window.addEventListener("framezoo-moonshine-state", handler);
  return () => window.removeEventListener("framezoo-moonshine-state", handler);
}

export function setMoonshineModelPromptHandler(
  handler: ((entry: MoonshineModelEntry) => Promise<boolean>) | null,
) {
  modelPromptHandler = handler;
}

export function normalizeMoonshineLanguage(language: string) {
  const value = (language || "en").trim().toLowerCase();
  const baseLanguage = value.split(/[-_]/)[0] ?? value;
  return ISO_639_3_TO_1[baseLanguage] ?? baseLanguage;
}

async function loadCatalog() {
  catalogPromise ??= fetch(
    new URL("/moonshine/catalog.json", window.location.href),
  ).then(async (response) => {
    if (!response.ok) throw new Error("Moonshine catalog is unavailable");
    return (await response.json()) as MoonshineCatalog;
  });
  return catalogPromise;
}

function architectureForLanguage(
  catalog: MoonshineCatalog,
  language: string,
): MoonshineModelEntry | null {
  const normalized = normalizeMoonshineLanguage(language);
  return (
    catalog.models.tiny?.[normalized] ??
    catalog.models.base?.[normalized] ??
    null
  );
}

function toLocalUrl(entry: MoonshineModelEntry, fileName: string) {
  if (entry.bundled) {
    return new URL(
      `/moonshine/models/${entry.architecture}/${entry.language}/${fileName}`,
      window.location.href,
    ).href;
  }
  return `app://renderer/moonshine-cache/${entry.architecture}/${entry.language}/${encodeURIComponent(fileName)}`;
}

function modelForWorker(entry: MoonshineModelEntry) {
  return {
    language: entry.language,
    architecture: entry.architecture,
    bundled: entry.bundled,
    files: entry.files.map((file) => ({
      name: file.name,
      url: toLocalUrl(entry, file.name),
    })),
  };
}

function getNativeMoonshineApi() {
  if (
    !window.__FRAMEZOO_DESKTOP__ ||
    window.crossOriginIsolated ||
    typeof window.electronAPI?.loadMoonshineLocalModel !== "function" ||
    typeof window.electronAPI?.transcribeMoonshineLocal !== "function"
  ) {
    return null;
  }
  return window.electronAPI;
}

function getWorker() {
  return (worker ??= new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  }));
}

function requestWorker(
  request: Omit<WorkerRequest, "id">,
  transfer: Transferable[] = [],
): Promise<WorkerResponse> {
  const id = nextRequestId++;
  const nativeApi = getNativeMoonshineApi();
  if (nativeApi) {
    const requestId = String(id);
    activeNativeRequestIds.add(requestId);
    return (async () => {
      try {
        if (request.type === "load") {
          await nativeApi.loadMoonshineLocalModel!(
            request.model as WorkerModel,
          );
          return { id, type: "ok" };
        }
        if (request.type === "transcribe") {
          const transcript = await nativeApi.transcribeMoonshineLocal!(
            requestId,
            request.model as WorkerModel,
            request.audio as ArrayBuffer,
            request.sampleRate as number,
          );
          if (!("lines" in transcript)) {
            throw new DOMException("Aborted", "AbortError");
          }
          return {
            id,
            type: "transcript" as const,
            transcript: { lines: transcript.lines },
          };
        }
        throw new MoonshineRuntimeError("Unknown Moonshine local request");
      } finally {
        activeNativeRequestIds.delete(requestId);
      }
    })();
  }

  const currentWorker = getWorker();
  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) return;
      currentWorker.removeEventListener("message", handleMessage);
      currentWorker.removeEventListener("error", handleError);
      resolve(event.data);
    };
    const handleError = (event: ErrorEvent) => {
      currentWorker.removeEventListener("message", handleMessage);
      currentWorker.removeEventListener("error", handleError);
      reject(
        new MoonshineRuntimeError(event.message || "Moonshine worker crashed"),
      );
    };
    currentWorker.addEventListener("message", handleMessage);
    currentWorker.addEventListener("error", handleError);
    try {
      currentWorker.postMessage({ ...request, id }, transfer);
    } catch (error) {
      currentWorker.removeEventListener("message", handleMessage);
      currentWorker.removeEventListener("error", handleError);
      reject(
        error instanceof Error
          ? error
          : new MoonshineRuntimeError(String(error)),
      );
    }
  });
}

async function ensureModelEntry(entry: MoonshineModelEntry) {
  const modelState = {
    ...startupState,
    models: {
      ...startupState.models,
      [entry.language]: { status: "warming" as const },
    },
  };
  publishState(modelState);

  try {
    if (!entry.bundled) {
      const api = window.electronAPI;
      if (typeof api?.hasMoonshineModel === "function") {
        const available = await api.hasMoonshineModel(
          entry.architecture,
          entry.language,
        );
        if (!available) {
          if (!modelPromptHandler || !(await modelPromptHandler(entry))) {
            throw new MoonshineModelCancelledError();
          }
        }
      } else if (!modelPromptHandler) {
        throw new MoonshineRuntimeError("Moonshine model cache is unavailable");
      } else if (!(await modelPromptHandler(entry))) {
        throw new MoonshineModelCancelledError();
      }
    }

    const result = await requestWorker({
      type: "load",
      model: modelForWorker(entry),
    });
    if (result.type === "error")
      throw new MoonshineRuntimeError(result.message);
    publishState({
      ...startupState,
      models: {
        ...startupState.models,
        [entry.language]: { status: "ready" },
      },
    });
  } catch (error) {
    publishState({
      ...startupState,
      models: {
        ...startupState.models,
        [entry.language]: {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      },
    });
    throw error;
  }
}

export async function preloadMoonshineModels(): Promise<MoonshineStartupState> {
  if (startupPromise) return startupPromise;
  startupPromise = (async () => {
    const hardware = checkMoonshineHardware();
    publishState({ ...startupState, status: "warming", hardware });
    if (!hardware.eligible) {
      const degraded = {
        ...startupState,
        status: "degraded" as const,
        hardware,
        message: hardware.reason,
      };
      publishState(degraded);
      return degraded;
    }

    try {
      const catalog = await loadCatalog();
      for (const language of ["en", "ko"]) {
        const entry = catalog.models.tiny?.[language];
        if (entry) await ensureModelEntry(entry);
      }
      const ready = { ...startupState, status: "ready" as const, hardware };
      publishState(ready);
      return ready;
    } catch (error) {
      const degraded = {
        ...startupState,
        status: "degraded" as const,
        hardware,
        message: error instanceof Error ? error.message : String(error),
      };
      publishState(degraded);
      return degraded;
    }
  })();
  return startupPromise;
}

export async function ensureMoonshineModel(language: string) {
  if (localDisabledForSession) return null;
  const hardware = checkMoonshineHardware();
  if (!hardware.eligible) return null;
  const catalog = await loadCatalog();
  const normalizedLanguage = normalizeMoonshineLanguage(language);
  const entry = architectureForLanguage(catalog, normalizedLanguage);
  if (!entry) {
    throw new MoonshineLanguageUnavailableError(normalizedLanguage);
  }
  await ensureModelEntry(entry);
  return entry;
}

export function decodeMoonshineWav(data: Uint8Array) {
  if (data.byteLength < 12) {
    throw new MoonshineRuntimeError("Audio must be a RIFF/WAVE file");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (
    view.getUint32(0, false) !== 0x52494646 ||
    view.getUint32(8, false) !== 0x57415645
  ) {
    throw new MoonshineRuntimeError("Audio must be a RIFF/WAVE file");
  }

  let formatOffset = -1;
  let formatLength = 0;
  let dataOffset = -1;
  let dataLength = 0;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    if (end > view.byteLength) {
      throw new MoonshineRuntimeError("Audio contains a truncated WAV chunk");
    }
    const chunkId = view.getUint32(offset, false);
    if (chunkId === 0x666d7420 && formatOffset < 0) {
      formatOffset = start;
      formatLength = size;
    } else if (chunkId === 0x64617461 && dataOffset < 0) {
      dataOffset = start;
      dataLength = size;
    }
    offset = end + (size & 1);
  }

  if (formatOffset < 0 || formatLength < 16 || dataOffset < 0) {
    throw new MoonshineRuntimeError("Audio must contain valid WAV chunks");
  }

  const audioFormat = view.getUint16(formatOffset, true);
  const channels = view.getUint16(formatOffset + 2, true);
  const sampleRate = view.getUint32(formatOffset + 4, true);
  const blockAlign = view.getUint16(formatOffset + 12, true);
  const bitsPerSample = view.getUint16(formatOffset + 14, true);

  if (audioFormat === 0xfffe) {
    if (
      formatLength < 40 ||
      view.getUint16(formatOffset + 16, true) < 22 ||
      ![
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa,
        0x00, 0x38, 0x9b, 0x71,
      ].every(
        (value, index) => view.getUint8(formatOffset + 24 + index) === value,
      )
    ) {
      throw new MoonshineRuntimeError(
        "Audio must use PCM WAVE_FORMAT_EXTENSIBLE",
      );
    }
  } else if (audioFormat !== 1) {
    throw new MoonshineRuntimeError("Audio must be signed 16-bit PCM WAV");
  }

  if (
    ![1, 2].includes(channels) ||
    bitsPerSample !== 16 ||
    blockAlign !== channels * 2 ||
    sampleRate <= 0 ||
    dataLength <= 0
  ) {
    throw new MoonshineRuntimeError("Audio must be signed 16-bit PCM WAV");
  }
  if (dataLength % blockAlign !== 0) {
    throw new MoonshineRuntimeError(
      "Audio data is not aligned to complete PCM frames",
    );
  }

  const frameCount = dataLength / blockAlign;
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let total = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      total += view.getInt16(
        dataOffset + frame * blockAlign + channel * 2,
        true,
      );
    }
    samples[frame] = total / channels / 32768;
  }

  return {
    samples,
    sampleRate,
    durationMs: Math.round((frameCount * 1000) / sampleRate),
  };
}

export async function transcribeMoonshine(
  entry: MoonshineModelEntry,
  audio: Uint8Array,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const { samples, sampleRate, durationMs } = decodeMoonshineWav(audio);
  const floatAudio = samples;
  const timeoutMs = Math.max(
    LOCAL_INFERENCE_TIMEOUT_MIN_MS,
    (durationMs / 1000) * LOCAL_INFERENCE_TIMEOUT_FACTOR * 1000 +
      LOCAL_INFERENCE_TIMEOUT_EXTRA_MS,
  );
  const response = requestWorker(
    {
      type: "transcribe",
      language: entry.language,
      architecture: entry.architecture,
      model: modelForWorker(entry),
      audio: floatAudio.buffer,
      sampleRate,
    },
    [floatAudio.buffer],
  );
  let abortHandler: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortHandler = () => {
      cancelNativeMoonshineRequests();
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) abortHandler();
    else signal?.addEventListener("abort", abortHandler, { once: true });
  });
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let result: WorkerResponse;
  try {
    result = await Promise.race([
      response,
      abortPromise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(new MoonshineRuntimeError("Moonshine inference timed out")),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      disableMoonshineForSession();
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (result.type === "error") throw new MoonshineRuntimeError(result.message);
  if (result.type !== "transcript") {
    throw new MoonshineRuntimeError("Moonshine returned no transcript");
  }
  return result.transcript.lines.map((line) => ({
    startMs: Math.round(line.startTime * 1000),
    endMs: Math.round(line.startTime * 1000) + Math.round(line.duration * 1000),
  }));
}

export function disableMoonshineForSession() {
  localDisabledForSession = true;
  cancelNativeMoonshineRequests();
  worker?.terminate();
  worker = null;
}

export function terminateMoonshineWorker() {
  cancelNativeMoonshineRequests();
  worker?.terminate();
  worker = null;
}

function cancelNativeMoonshineRequests() {
  const api = getNativeMoonshineApi();
  if (!api?.cancelMoonshineLocal) return;
  for (const requestId of activeNativeRequestIds) {
    void api.cancelMoonshineLocal(requestId);
  }
}

export async function downloadMoonshineModel(
  entry: MoonshineModelEntry,
  signal?: AbortSignal,
) {
  const api = window.electronAPI;
  if (typeof api?.downloadMoonshineModel !== "function") {
    throw new MoonshineRuntimeError("Model download is unavailable");
  }
  const requestId = crypto.randomUUID();
  const abortHandler = () => {
    void api.cancelMoonshineModelDownload?.(requestId);
  };
  signal?.addEventListener("abort", abortHandler, { once: true });
  const timeout = setTimeout(
    () => api.cancelMoonshineModelDownload?.(requestId),
    MODEL_DOWNLOAD_TIMEOUT_MS,
  );
  try {
    await api.downloadMoonshineModel(requestId, {
      architecture: entry.architecture,
      language: entry.language,
      files: entry.files.map(({ name, url, size, checksum, checksumType }) => ({
        name,
        url,
        size,
        checksum,
        checksumType,
      })),
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortHandler);
  }
}

export function cancelMoonshineModelDownload(requestId: string) {
  return window.electronAPI?.cancelMoonshineModelDownload?.(requestId);
}
