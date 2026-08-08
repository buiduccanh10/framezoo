import React, { useEffect, useState } from "react";

import { getInitialLandingLocale, getLandingCopy } from "./i18n";

export function DeepLinkPage({ path }: { path: string }) {
  const t = getLandingCopy(getInitialLandingLocale());
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    // Strip leading slash just in case
    const safePath = path.startsWith("/") ? path.substring(1) : path;
    const appUrl = `framezoo://${safePath}`;

    // Attempt to open the desktop app
    window.location.replace(appUrl);

    // Show fallback if app didn't open after a delay
    const timer = setTimeout(() => {
      setShowFallback(true);
    }, 2500);

    return () => clearTimeout(timer);
  }, [path]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f0f13] text-white p-4 font-sans">
      <div className="max-w-md w-full bg-[#1c1c24] rounded-2xl p-8 shadow-2xl border border-white/5 text-center">
        <div className="w-16 h-16 mx-auto mb-6 bg-blue-600 rounded-full flex items-center justify-center animate-pulse">
          <svg
            className="w-8 h-8 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        <h1 className="text-2xl font-bold mb-3">{t.deepLink.opening}</h1>
        <p className="text-gray-400 mb-8 leading-relaxed">
          {t.deepLink.openingDescription.split("<1>").map((part, index) => {
            if (index === 0) return part;
            const [boldText, restText] = part.split("</1>");
            return (
              <React.Fragment key={index}>
                <strong>{boldText}</strong>
                {restText}
              </React.Fragment>
            );
          })}
        </p>

        <div
          className={`transition-opacity duration-500 flex flex-col gap-3 ${showFallback ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        >
          <a
            href={`framezoo://${path.startsWith("/") ? path.substring(1) : path}`}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors duration-200"
          >
            {t.deepLink.retry}
          </a>
          <a
            href="https://framezoo.top/#download"
            target="_blank"
            rel="noreferrer"
            className="w-full py-3 px-4 bg-white/10 hover:bg-white/20 text-white font-medium rounded-xl transition-colors duration-200"
          >
            {t.deepLink.download}
          </a>
          <a
            href="/"
            className="w-full py-3 px-4 text-gray-400 hover:text-white font-medium transition-colors duration-200 mt-2"
          >
            {t.deepLink.backHome}
          </a>
        </div>
      </div>
    </div>
  );
}
