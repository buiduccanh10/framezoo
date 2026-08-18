import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

export type MoonshineNodeModel = {
  language: string;
  architecture: "tiny" | "base";
  bundled: boolean;
  files: Array<{ name: string }>;
};

type MoonshineNodeRequestPayload =
  | {
      type: "load";
      key: string;
      architecture: "tiny" | "base";
      files: Array<{ name: string; bytes: Uint8Array }>;
    }
  | {
      type: "transcribe";
      key: string;
      audio: ArrayBuffer;
      sampleRate: number;
    };

type MoonshineNodeRequest = MoonshineNodeRequestPayload & { id: number };

type MoonshineNodeResponse =
  | { id: number; type: "ok" }
  | {
      id: number;
      type: "transcript";
      transcript: { lines: Array<{ startTime: number; duration: number }> };
    }
  | { id: number; type: "error"; message: string };

type PendingRequest = {
  externalRequestId?: string;
  resolve: (response: MoonshineNodeResponse) => void;
  reject: (error: Error) => void;
};

const workerSource = (moonshineRuntimeRootUrl: string) => `
const { parentPort } = require("node:worker_threads");
const moonshineRuntimeRootUrl = ${JSON.stringify(moonshineRuntimeRootUrl)};
let runtimePromise;
const transcribers = new Map();

async function getRuntime() {
  runtimePromise ??= Promise.all([
    import(new URL("enums.js", moonshineRuntimeRootUrl).href),
    import(new URL("module.js", moonshineRuntimeRootUrl).href),
    import(new URL("transcriber.js", moonshineRuntimeRootUrl).href),
  ]).then(([enumsModule, moduleModule, transcriberModule]) => ({
    ModelArch: enumsModule.ModelArch,
    Transcriber: transcriberModule.Transcriber,
    loadMoonshineModule: moduleModule.loadMoonshineModule,
  }));
  return runtimePromise;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

parentPort.on("message", async (request) => {
  try {
    const runtime = await getRuntime();
    if (request.type === "load") {
      if (!transcribers.has(request.key)) {
        const files = new Map(
          request.files.map((file) => [file.name, new Uint8Array(file.bytes)]),
        );
        const transcriber = await runtime.Transcriber.load({
          files,
          modelArch:
            request.architecture === "base"
              ? runtime.ModelArch.Base
              : runtime.ModelArch.Tiny,
          module: await runtime.loadMoonshineModule(),
        });
        transcribers.set(request.key, transcriber);
      }
      parentPort.postMessage({ id: request.id, type: "ok" });
      return;
    }
    if (request.type === "transcribe") {
      const transcriber = transcribers.get(request.key);
      if (!transcriber) throw new Error("Moonshine model is not loaded");
      const transcript = transcriber.transcribe(
        new Float32Array(request.audio),
        { sampleRate: request.sampleRate },
      );
      parentPort.postMessage({ id: request.id, type: "transcript", transcript });
      return;
    }
    throw new Error("Unknown Moonshine worker request");
  } catch (error) {
    parentPort.postMessage({
      id: request.id,
      type: "error",
      message: errorMessage(error),
    });
  }
});
`;

function modelKey(
  model: Pick<MoonshineNodeModel, "language" | "architecture">,
) {
  return `${model.architecture}:${model.language}`;
}

function assertSafeModel(model: MoonshineNodeModel) {
  if (
    !["tiny", "base"].includes(model.architecture) ||
    !/^[a-z0-9_-]+$/i.test(model.language) ||
    !Array.isArray(model.files) ||
    model.files.length === 0
  ) {
    throw new Error("Invalid Moonshine local model request");
  }
  for (const file of model.files) {
    if (!/^[a-z0-9._-]+$/i.test(file.name)) {
      throw new Error("Invalid Moonshine local model file");
    }
  }
}

export class MoonshineNodeRuntime {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly externalRequestIds = new Map<string, number>();
  private readonly activeExternalRequestIds = new Set<string>();
  private readonly cancelledRequestIds = new Set<string>();
  private readonly loadedModels = new Set<string>();
  private readonly moonshineRuntimeRootUrl: string;

  constructor(
    private readonly getBundledModelRoots: () => string[],
    private readonly getCachedModelRoot: () => string,
    getMoonshineRuntimeRoot: () => string,
  ) {
    this.moonshineRuntimeRootUrl = pathToFileURL(
      `${getMoonshineRuntimeRoot()}${path.sep}`,
    ).href;
  }

  private getWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(workerSource(this.moonshineRuntimeRootUrl), {
      eval: true,
    });
    worker.on("message", (response: MoonshineNodeResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (pending.externalRequestId) {
        this.externalRequestIds.delete(pending.externalRequestId);
      }
      if (response.type === "error") {
        pending.reject(new Error(response.message));
      } else {
        pending.resolve(response);
      }
    });
    worker.on("error", (error) => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.loadedModels.clear();
      this.rejectPending(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
    worker.on("exit", (code) => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.loadedModels.clear();
      if (code !== 0) {
        this.rejectPending(
          new Error(`Moonshine Node worker exited with code ${code}`),
        );
      }
    });
    this.worker = worker;
    return worker;
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.externalRequestIds.clear();
  }

  private terminateWorker(error: Error) {
    const worker = this.worker;
    this.worker = null;
    this.loadedModels.clear();
    this.rejectPending(error);
    if (worker) void worker.terminate();
  }

  private request(
    request: MoonshineNodeRequestPayload,
    transfer: ArrayBuffer[],
    externalRequestId?: string,
  ) {
    const worker = this.getWorker();
    const id = this.nextRequestId++;
    const message = { ...request, id } as MoonshineNodeRequest;
    return new Promise<MoonshineNodeResponse>((resolve, reject) => {
      this.pending.set(id, { externalRequestId, resolve, reject });
      if (externalRequestId) this.externalRequestIds.set(externalRequestId, id);
      try {
        worker.postMessage(message, transfer);
      } catch (error) {
        this.pending.delete(id);
        if (externalRequestId)
          this.externalRequestIds.delete(externalRequestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async readModelFiles(model: MoonshineNodeModel) {
    const roots = model.bundled
      ? this.getBundledModelRoots()
      : [this.getCachedModelRoot()];
    const files: Array<{ name: string; bytes: Uint8Array }> = [];
    for (const file of model.files) {
      let filePath: string | null = null;
      for (const root of roots) {
        const candidate = path.join(
          root,
          model.architecture,
          model.language,
          file.name,
        );
        try {
          const stat = await fs.stat(candidate);
          if (stat.isFile()) {
            filePath = candidate;
            break;
          }
        } catch {
          // Try the next renderer/cache root.
        }
      }
      if (!filePath) {
        throw new Error(
          `Moonshine local model file is unavailable: ${model.language}/${file.name}`,
        );
      }
      files.push({
        name: file.name,
        bytes: new Uint8Array(await fs.readFile(filePath)),
      });
    }
    return files;
  }

  async loadModel(model: MoonshineNodeModel, externalRequestId?: string) {
    assertSafeModel(model);
    const key = modelKey(model);
    if (this.loadedModels.has(key)) return;
    if (externalRequestId && this.cancelledRequestIds.has(externalRequestId)) {
      throw new DOMException("Aborted", "AbortError");
    }
    const files = await this.readModelFiles(model);
    if (externalRequestId && this.cancelledRequestIds.has(externalRequestId)) {
      throw new DOMException("Aborted", "AbortError");
    }
    const result = await this.request(
      {
        type: "load",
        key,
        architecture: model.architecture,
        files,
      },
      files.map((file) => file.bytes.buffer as ArrayBuffer),
      externalRequestId,
    );
    if (result.type === "error") throw new Error(result.message);
    this.loadedModels.add(key);
  }

  async transcribe(
    requestId: string,
    model: MoonshineNodeModel,
    audio: ArrayBuffer,
    sampleRate: number,
  ) {
    this.activeExternalRequestIds.add(requestId);
    try {
      await this.loadModel(model, requestId);
      if (this.cancelledRequestIds.has(requestId)) {
        throw new DOMException("Aborted", "AbortError");
      }
      const result = await this.request(
        {
          type: "transcribe",
          key: modelKey(model),
          audio,
          sampleRate,
        },
        [audio],
        requestId,
      );
      if (result.type === "error") throw new Error(result.message);
      if (result.type !== "transcript") {
        throw new Error("Moonshine returned no transcript");
      }
      return result.transcript;
    } finally {
      this.activeExternalRequestIds.delete(requestId);
      this.cancelledRequestIds.delete(requestId);
      this.externalRequestIds.delete(requestId);
    }
  }

  cancel(requestId: string) {
    if (!this.activeExternalRequestIds.has(requestId)) return false;
    this.cancelledRequestIds.add(requestId);
    if (this.externalRequestIds.has(requestId)) {
      this.terminateWorker(new DOMException("Aborted", "AbortError"));
    }
    return true;
  }

  cancelAll() {
    const requestIds = [...this.activeExternalRequestIds];
    for (const requestId of requestIds) this.cancel(requestId);
    return requestIds.length > 0;
  }

  close() {
    this.terminateWorker(new Error("Moonshine Node worker closed"));
  }
}
