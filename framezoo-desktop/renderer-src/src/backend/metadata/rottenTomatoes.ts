import { ofetch } from "ofetch";

import { conf } from "@/setup/config";

export interface RottenTomatoesMovie {
  title: string;
  tomatoIcon: "certified_fresh" | "fresh" | "rotten";
  tomatoScore: number;
  url: string;
  popcornIcon?: "upright" | "spilled" | "empty";
  popcornScore?: number;
  popcornAverageRating?: number | null;
  popcornBandedRatingCount?: string | null;
  popcornReviewCount?: number | null;
  popcornUrl?: string | null;
}

export async function getRottenTomatoesMetadata(
  title: string,
  year?: number,
): Promise<RottenTomatoesMovie | null> {
  const backendUrl = conf().BACKEND_URL;
  if (!backendUrl) return null;

  return ofetch<RottenTomatoesMovie | null>("/rt/search", {
    baseURL: backendUrl,
    credentials: "include",
    query: {
      title,
      ...(year ? { year } : {}),
    },
  });
}
