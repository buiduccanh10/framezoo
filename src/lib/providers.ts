type AnyRecord = Record<string, any>;

export type Qualities = "360" | "480" | "720" | "1080" | "4k" | "unknown";

export type Caption = {
  id: string;
  type: string;
  url: string;
  language: string;
  hasCorsRestrictions: boolean;
  [key: string]: any;
};

export type StreamHeaders = Record<string, string>;

type BaseStream = {
  id?: string;
  captions: Caption[];
  headers?: StreamHeaders;
  preferredHeaders?: StreamHeaders;
  flags?: string[];
  skipValidation?: boolean;
  [key: string]: any;
};

type HlsStream = BaseStream & {
  type: "hls";
  playlist: string;
};

type FileStream = BaseStream & {
  type: "file";
  qualities: Record<string, { type: "mp4"; url: string }>;
};

export type Stream = HlsStream | FileStream;

export type MovieMedia = {
  type: "movie";
  tmdbId: string;
  title: string;
  releaseYear?: number;
  [key: string]: any;
};

export type ShowMedia = {
  type: "show";
  tmdbId: string;
  title: string;
  season: { number: number; tmdbId?: string; [key: string]: any };
  episode: { number: number; tmdbId?: string; [key: string]: any };
  [key: string]: any;
};

export type ScrapeMedia = MovieMedia | ShowMedia;

export type RunOutput = {
  sourceId: string;
  embedId?: string;
  stream: Stream;
};

export type SourcererOutput = {
  stream?: Stream[];
  embeds: Array<{ embedId: string; url: string }>;
};

export type EmbedOutput = {
  stream: Stream[];
};

export type MetaOutput = {
  id: string;
  name: string;
  rank: number;
  type: "source" | "embed";
  [key: string]: any;
};

export interface FullScraperEvents {
  init?: (evt: { sourceIds: string[] }) => void;
  start?: (id: string) => void;
  update?: (evt: {
    id: string;
    status: "failure" | "pending" | "notfound" | "success" | "waiting";
    reason?: string;
    error?: any;
    percentage: number;
  }) => void;
  discoverEmbeds?: (evt: {
    sourceId: string;
    embeds: Array<{ id: string; embedScraperId: string }>;
  }) => void;
  [key: string]: ((...args: any[]) => any) | undefined;
}

export interface ProviderControls {
  listSources: () => MetaOutput[];
  listEmbeds: () => MetaOutput[];
  runAll: (options: BuildOptions) => Promise<RunOutput | null>;
  runSourceScraper: (options: {
    id: string;
    media: ScrapeMedia;
  }) => Promise<SourcererOutput>;
  runEmbedScraper: (options: {
    id: string;
    url: string;
  }) => Promise<EmbedOutput>;
}

export type Fetcher = (
  url: string,
  ops: AnyRecord,
) => Promise<{
  body: string;
  finalUrl: string;
  statusCode: number;
  headers: Headers;
}>;

export type MovieScrapeContext = {
  media: AnyRecord;
  fetcher: <T = any>(url: string, init?: RequestInit) => Promise<T>;
  progress: (percentage: number) => void;
};

export type ShowScrapeContext = MovieScrapeContext;

export type EmbedScrapeContext = {
  url: string;
  fetcher: <T = any>(url: string, init?: RequestInit) => Promise<T>;
  progress: (percentage: number) => void;
};

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export const flags = {
  CORS_ALLOWED: "CORS_ALLOWED",
} as const;

export const targets = {
  BROWSER: "BROWSER",
  BROWSER_EXTENSION: "BROWSER_EXTENSION",
  NATIVE: "NATIVE",
} as const;

let currentM3U8ProxyUrl = "";

export function setM3U8ProxyUrl(url: string) {
  currentM3U8ProxyUrl = url;
}

async function toFetcherResponse(
  response: Response,
  originalUrl: string,
): Promise<{
  body: string;
  finalUrl: string;
  statusCode: number;
  headers: Headers;
}> {
  const body = await response.text();
  return {
    body,
    finalUrl: response.url || originalUrl,
    statusCode: response.status,
    headers: response.headers,
  };
}

export function makeSimpleProxyFetcher(
  proxyUrl: string,
  fetchImpl: typeof fetch = fetch,
): Fetcher {
  return async (url, ops = {}) => {
    const targetUrl = proxyUrl
      ? `${proxyUrl}${proxyUrl.includes("?") ? "&" : "?"}destination=${encodeURIComponent(url)}`
      : url;
    const safeOps = ops as AnyRecord;
    const response = await fetchImpl(targetUrl, {
      method: safeOps.method ?? "GET",
      headers: safeOps.headers,
      body: safeOps.body,
    });
    return toFetcherResponse(response, url);
  };
}

export function makeStandardFetcher(fetchImpl: typeof fetch) {
  return async function standardFetcher<T = any>(
    url: string,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetchImpl(url, init);
    if (!response.ok) {
      throw new Error(
        `Request failed: ${response.status} ${response.statusText}`,
      );
    }

    const text = await response.text();
    if (!text) return {} as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  };
}

type SourceDefinition = {
  id: string;
  name: string;
  rank?: number;
  type?: "source";
  scrapeMovie?: (ctx: MovieScrapeContext) => Promise<SourcererOutput>;
  scrapeShow?: (ctx: ShowScrapeContext) => Promise<SourcererOutput>;
};

type EmbedDefinition = {
  id: string;
  name: string;
  rank?: number;
  type?: "embed";
  scrape: (ctx: EmbedScrapeContext) => Promise<EmbedOutput>;
};

type BuildOptions = {
  media: ScrapeMedia;
  sourceOrder?: string[];
  embedOrder?: string[];
  events?: FullScraperEvents;
};

function normalizeSourcererOutput(output: any): {
  stream: Stream[];
  embeds: Array<{ embedId: string; url: string }>;
} {
  if (!output) {
    return { stream: [], embeds: [] };
  }

  return {
    stream: Array.isArray(output.stream) ? output.stream : [],
    embeds: Array.isArray(output.embeds) ? output.embeds : [],
  };
}

function normalizeEmbedOutput(output: any): { stream: Stream[] } {
  if (!output) return { stream: [] };
  return {
    stream: Array.isArray(output.stream) ? output.stream : [],
  };
}

class ProviderBuilder {
  private fetcher = makeStandardFetcher(fetch);
  private sources: SourceDefinition[] = [];
  private embeds: EmbedDefinition[] = [];

  setFetcher(fetcher: any) {
    this.fetcher = fetcher;
    return this;
  }

  setProxiedFetcher(_fetcher: any) {
    return this;
  }

  setTarget(_target: any) {
    return this;
  }

  enableConsistentIpForRequests() {
    return this;
  }

  addBuiltinProviders() {
    return this;
  }

  addSource(source: SourceDefinition) {
    this.sources.push(source);
    return this;
  }

  addEmbed(embed: EmbedDefinition) {
    this.embeds.push(embed);
    return this;
  }

  build(): ProviderControls {
    const sources = [...this.sources];
    const embeds = [...this.embeds];
    const fetcher = this.fetcher;

    const listSources = () =>
      [...sources]
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
        .map(
          (source): MetaOutput =>
            ({
              ...source,
              rank: source.rank ?? 0,
              type: "source" as const,
            }) as MetaOutput,
        );

    const listEmbeds = () =>
      [...embeds]
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
        .map(
          (embed): MetaOutput =>
            ({
              ...embed,
              rank: embed.rank ?? 0,
              type: "embed" as const,
            }) as MetaOutput,
        );

    const runSourceScraper: ProviderControls["runSourceScraper"] = async ({
      id,
      media,
    }) => {
      const source = sources.find((item) => item.id === id);
      if (!source) throw new NotFoundError(`Source not found: ${id}`);

      const progress = () => {};
      const ctx = { media, fetcher, progress };

      if (media?.type === "movie") {
        if (!source.scrapeMovie)
          throw new NotFoundError("Source cannot scrape movies");
        return normalizeSourcererOutput(await source.scrapeMovie(ctx));
      }

      if (media?.type === "show") {
        if (!source.scrapeShow)
          throw new NotFoundError("Source cannot scrape shows");
        return normalizeSourcererOutput(await source.scrapeShow(ctx));
      }

      throw new NotFoundError("Unsupported media type");
    };

    const runEmbedScraper: ProviderControls["runEmbedScraper"] = async ({
      id,
      url,
    }) => {
      const embed = embeds.find((item) => item.id === id);
      if (!embed) throw new NotFoundError(`Embed not found: ${id}`);

      const progress = () => {};
      const ctx = { url, fetcher, progress };
      return normalizeEmbedOutput(await embed.scrape(ctx));
    };

    const runAll: ProviderControls["runAll"] = async ({
      media,
      sourceOrder,
      embedOrder,
      events,
    }) => {
      const orderedSourceIds =
        sourceOrder && sourceOrder.length > 0
          ? sourceOrder
          : listSources().map((source) => source.id);

      events?.init?.({ sourceIds: orderedSourceIds });

      for (const sourceId of orderedSourceIds) {
        const source = sources.find((item) => item.id === sourceId);
        if (!source) continue;

        const update = (
          status: "failure" | "pending" | "notfound" | "success" | "waiting",
          extra?: Partial<{ reason: string; error: any; percentage: number }>,
        ) => {
          events?.update?.({
            id: sourceId,
            status,
            percentage: extra?.percentage ?? (status === "success" ? 100 : 0),
            reason: extra?.reason,
            error: extra?.error,
          });
        };

        events?.start?.(sourceId);
        update("pending", { percentage: 0 });

        try {
          const ctxProgress = (percentage: number) => {
            update("pending", {
              percentage: Number.isFinite(percentage) ? percentage : 0,
            });
          };
          const ctx = { media, fetcher, progress: ctxProgress };

          let sourceResult: {
            stream: Stream[];
            embeds: Array<{ embedId: string; url: string }>;
          };
          if (media?.type === "movie") {
            if (!source.scrapeMovie)
              throw new NotFoundError("Source cannot scrape movies");
            sourceResult = normalizeSourcererOutput(
              await source.scrapeMovie(ctx),
            );
          } else if (media?.type === "show") {
            if (!source.scrapeShow)
              throw new NotFoundError("Source cannot scrape shows");
            sourceResult = normalizeSourcererOutput(
              await source.scrapeShow(ctx),
            );
          } else {
            throw new NotFoundError("Unsupported media type");
          }

          if (sourceResult.stream.length > 0) {
            update("success", { percentage: 100 });
            return {
              sourceId,
              stream: sourceResult.stream[0],
            };
          }

          if (sourceResult.embeds.length > 0) {
            const discovered = sourceResult.embeds.map((embed, index) => ({
              id: `${sourceId}::${embed.embedId}::${index}`,
              embedId: embed.embedId,
              url: embed.url,
            }));

            events?.discoverEmbeds?.({
              sourceId,
              embeds: discovered.map((item) => ({
                id: item.id,
                embedScraperId: item.embedId,
              })),
            });

            const orderedEmbeds = [...discovered].sort((a, b) => {
              if (!embedOrder || embedOrder.length === 0) return 0;
              const aIdx = embedOrder.indexOf(a.embedId);
              const bIdx = embedOrder.indexOf(b.embedId);
              const av = aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx;
              const bv = bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx;
              return av - bv;
            });

            for (const embed of orderedEmbeds) {
              events?.start?.(embed.id);
              events?.update?.({
                id: embed.id,
                status: "pending",
                percentage: 0,
              });

              try {
                const embedResult = normalizeEmbedOutput(
                  await runEmbedScraper({ id: embed.embedId, url: embed.url }),
                );
                if (embedResult.stream.length > 0) {
                  events?.update?.({
                    id: embed.id,
                    status: "success",
                    percentage: 100,
                  });
                  update("success", { percentage: 100 });
                  return {
                    sourceId,
                    embedId: embed.embedId,
                    stream: embedResult.stream[0],
                  };
                }

                events?.update?.({
                  id: embed.id,
                  status: "notfound",
                  percentage: 100,
                });
              } catch (error) {
                const status =
                  error instanceof NotFoundError ? "notfound" : "failure";
                events?.update?.({
                  id: embed.id,
                  status,
                  reason:
                    error instanceof Error ? error.message : "Unknown error",
                  error,
                  percentage: 100,
                });
              }
            }
          }

          update("notfound", { percentage: 100, reason: "No stream found" });
        } catch (error) {
          const status =
            error instanceof NotFoundError ? "notfound" : "failure";
          update(status, {
            percentage: 100,
            reason: error instanceof Error ? error.message : "Unknown error",
            error,
          });
        }
      }

      return null;
    };

    return {
      listSources,
      listEmbeds,
      runAll,
      runSourceScraper,
      runEmbedScraper,
    };
  }
}

export function buildProviders() {
  return new ProviderBuilder();
}

const languageAliases: Record<string, string> = {
  english: "en",
  vietnamese: "vi",
  french: "fr",
  german: "de",
  spanish: "es",
  portuguese: "pt",
  italian: "it",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
  thai: "th",
  indonesian: "id",
  russian: "ru",
};

export function labelToLanguageCode(label?: string | null): string | null {
  if (!label) return null;

  const normalized = label.trim().toLowerCase();
  if (!normalized) return null;

  if (languageAliases[normalized]) return languageAliases[normalized];

  const compact = normalized.replace(/[^a-z-]/g, "");
  if (compact.length >= 2) return compact.slice(0, 2);

  return null;
}

export function getCurrentM3U8ProxyUrl() {
  return currentM3U8ProxyUrl;
}
