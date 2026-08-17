export type MoonshineArchitecture = "tiny" | "base";

export interface MoonshineModelFile {
  name: string;
  url: string;
  size: number;
  checksum: string | null;
  checksumType: string | null;
}

export interface MoonshineModelEntry {
  language: string;
  architecture: MoonshineArchitecture;
  bundled: boolean;
  files: MoonshineModelFile[];
}

export interface MoonshineCatalog {
  version: number;
  generatedAt?: string;
  unsupportedLanguages?: string[];
  unsupportedByArchitecture?: Partial<Record<MoonshineArchitecture, string[]>>;
  models: Partial<
    Record<MoonshineArchitecture, Partial<Record<string, MoonshineModelEntry>>>
  >;
}

export type MoonshineStartupStatus = "idle" | "warming" | "ready" | "degraded";

export interface MoonshineStartupState {
  status: MoonshineStartupStatus;
  hardware: {
    eligible: boolean;
    reason?: string;
    hardwareConcurrency: number | null;
    deviceMemory: number | null;
    crossOriginIsolated: boolean;
  };
  models: Partial<
    Record<
      string,
      { status: "idle" | "warming" | "ready" | "error"; message?: string }
    >
  >;
  message?: string;
}

export interface MoonshineAlignmentInterval {
  startMs: number;
  endMs: number;
}

export interface MoonshineAlignmentResult {
  aligned: boolean;
  offsetMs: number;
  confidence: number;
  speechIntervals: MoonshineAlignmentInterval[];
  speechAnchorCount?: number;
  speechAnchorCoverage?: number;
  segments?: Array<{
    startMs: number;
    endMs: number;
    offsetMs: number;
  }>;
  reason: string | null;
}
