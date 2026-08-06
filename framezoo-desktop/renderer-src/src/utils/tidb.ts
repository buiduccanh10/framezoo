import { mwFetch } from "@/backend/helpers/fetch";
import { conf } from "@/setup/config";

export type SegmentType = "intro" | "recap" | "credits" | "preview";

export interface SubmissionRequest {
  tmdb_id: number;
  type: "movie" | "tv";
  segment: SegmentType;
  season?: number;
  episode?: number;
  start_sec?: number | null;
  end_sec?: number | null;
  start_ms?: number | null;
  end_ms?: number | null;
  tvdb_id?: number;
  imdb_id?: string;
}

export interface SubmissionResponse {
  ok: boolean;
  submission?: {
    id: string;
    tmdbId: number;
    type: "movie" | "tv";
    segment: SegmentType;
    season?: number;
    episode?: number;
    startMs?: number | null;
    endMs?: number | null;
    status: "pending" | "accepted" | "rejected";
    weight: number;
  };
}

export interface ErrorResponse {
  error: string;
  details?: string;
}

export class TIDBError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: string,
  ) {
    super(message);
    this.name = "TIDBError";
  }
}

function normalizeTidbError(error: unknown): TIDBError {
  if (error instanceof TIDBError) return error;

  const fetchError = error as {
    statusCode?: number;
    response?: {
      status?: number;
      statusText?: string;
      _data?: {
        statusMessage?: string;
        message?: string;
        data?: {
          details?: string;
        };
      };
    };
    data?: {
      statusMessage?: string;
      message?: string;
      data?: {
        details?: string;
      };
    };
    message?: string;
  };

  const responseData = fetchError.data ?? fetchError.response?._data;
  const message =
    responseData?.statusMessage ||
    responseData?.message ||
    fetchError.response?.statusText ||
    fetchError.message ||
    "Failed to submit segment";
  const details = responseData?.data?.details;
  const statusCode = fetchError.statusCode ?? fetchError.response?.status;

  return new TIDBError(message, statusCode, details);
}

/**
 * Submit segment timestamps to TheIntroDB API
 */
export async function submitIntro(
  submission: SubmissionRequest,
  apiKey?: string | null,
): Promise<SubmissionResponse> {
  const backendUrl = conf().BACKEND_URL?.replace(/\/+$/, "");
  if (backendUrl) {
    try {
      return await mwFetch<SubmissionResponse>(
        `${backendUrl}/api/skip-segments/submit`,
        {
          method: "POST",
          body: submission,
        },
      );
    } catch (error) {
      const normalizedError = normalizeTidbError(error);
      const shouldFallbackToClientKey =
        !!apiKey &&
        [404, 405, 501, 503].includes(normalizedError.statusCode ?? -1);

      if (!shouldFallbackToClientKey) {
        throw normalizedError;
      }
    }
  }

  if (!apiKey?.trim()) {
    throw new TIDBError("TIDB API key is not set");
  }

  const response = await fetch("https://api.theintrodb.org/v1/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(submission),
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    let details: string | undefined;

    try {
      const errorData: ErrorResponse = await response.json();
      errorMessage = errorData.error;
      details = errorData.details;
    } catch {
      errorMessage = response.statusText || errorMessage;
    }

    throw new TIDBError(errorMessage, response.status, details);
  }

  return response.json();
}
