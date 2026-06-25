import { ofetch } from "ofetch";

export interface AppDownloadOption {
  id: "mac-arm64" | "mac-x64" | "mac-universal";
  label: string;
  description: string;
  url: string;
}

export interface AppDownloadManifest {
  version: string;
  options: AppDownloadOption[];
}

export async function getAppDownloadManifest(
  backendUrl: string,
): Promise<AppDownloadManifest> {
  const manifest = await ofetch<AppDownloadManifest>("/download", {
    baseURL: backendUrl,
    credentials: "include",
  });

  return {
    ...manifest,
    options: manifest.options.map((option) => ({
      ...option,
      url: new URL(option.url, backendUrl).toString(),
    })),
  };
}
