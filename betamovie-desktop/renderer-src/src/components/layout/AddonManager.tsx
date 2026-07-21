import classNames from "classnames";
import { useState } from "react";

import { Icon, Icons } from "@/components/Icon";
import {
  installAddon,
  removeAddon,
  setAddonEnabled,
  useInstalledAddons,
} from "@/desktop/addons/store";
import { useIsDesktopApp } from "@/hooks/useIsDesktopApp";

export function AddonManager() {
  const isDesktop = useIsDesktopApp();
  const addons = useInstalledAddons();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isDesktop) return null;

  const add = async () => {
    setLoading(true);
    setError(null);
    try {
      await installAddon(url);
      setUrl("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to add addon",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="pointer-events-auto shrink-0 rounded-full text-lg text-white tabbable backdrop-blur-lg"
        onClick={() => setOpen(true)}
        aria-label="Manage addons"
        title="Manage addons"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-pill-background bg-opacity-50 transition-colors hover:bg-pill-backgroundHover">
          <Icon icon={Icons.PLUS} />
        </span>
      </button>

      {open ? (
        <div
          className="pointer-events-auto fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-dropdown-border bg-dropdown-altBackground p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Desktop addons
                </h2>
                <p className="mt-1 text-sm text-dropdown-text">
                  Add a Stremio manifest URL for torrent and direct streams.
                </p>
              </div>
              <button
                type="button"
                className="rounded p-2 text-dropdown-text hover:bg-dropdown-contentBackground hover:text-white"
                onClick={() => setOpen(false)}
                aria-label="Close addon manager"
              >
                <Icon icon={Icons.X} />
              </button>
            </div>

            <div className="flex gap-2">
              <input
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && url.trim()) void add();
                }}
                placeholder="https://torrentio.strem.fun/manifest.json"
                className="min-w-0 flex-1 rounded-lg border border-dropdown-border bg-dropdown-contentBackground px-3 py-2 text-sm text-white outline-none focus:border-type-link"
                disabled={loading}
              />
              <button
                type="button"
                className={classNames(
                  "rounded-lg bg-buttons-purple px-4 py-2 text-sm text-white hover:bg-buttons-purpleHover",
                  (!url.trim() || loading) && "cursor-not-allowed opacity-60",
                )}
                onClick={() => void add()}
                disabled={!url.trim() || loading}
              >
                {loading ? "Loading..." : "Add"}
              </button>
            </div>

            {error ? (
              <p className="mt-2 text-sm text-red-400">{error}</p>
            ) : null}

            <div className="mt-5 space-y-2">
              {addons.length === 0 ? (
                <p className="rounded-lg border border-dashed border-dropdown-border p-4 text-sm text-dropdown-text">
                  No addons installed.
                </p>
              ) : (
                addons.map((addon) => (
                  <div
                    key={addon.manifest.id}
                    className="flex items-center gap-3 rounded-lg border border-dropdown-border bg-dropdown-contentBackground p-3"
                  >
                    {addon.manifest.logo ? (
                      <img
                        src={addon.manifest.logo}
                        alt=""
                        className="h-9 w-9 rounded object-contain"
                      />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded bg-pill-background text-lg text-white">
                        <Icon icon={Icons.WEB} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {addon.manifest.name}
                      </p>
                      <p className="truncate text-xs text-dropdown-text">
                        {addon.manifestUrl}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-dropdown-text hover:bg-pill-backgroundHover hover:text-white"
                      onClick={() =>
                        setAddonEnabled(addon.manifest.id, !addon.enabled)
                      }
                    >
                      {addon.enabled ? "On" : "Off"}
                    </button>
                    <button
                      type="button"
                      className="rounded p-2 text-dropdown-text hover:bg-red-500/20 hover:text-red-300"
                      onClick={() => removeAddon(addon.manifest.id)}
                      aria-label={`Remove ${addon.manifest.name}`}
                    >
                      <Icon icon={Icons.X} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
