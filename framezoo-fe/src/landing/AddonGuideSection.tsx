import { useState } from "react";

import type { LandingCopy } from "./i18n";

interface AddonGuideSectionProps {
  copy: LandingCopy["addonGuide"];
}

const manifestExample = `{
  "id": "com.example.my-addon",
  "version": "1.0.0",
  "name": "My Addon",
  "description": "Streams and subtitles for my library.",
  "logo": "https://example.com/logo.png",
  "resources": ["stream", "subtitles"],
  "types": ["movie", "series"]
}`;

const streamExample = `GET /stream/movie/tt0133093.json

{
  "streams": [
    {
      "name": "Example 1080p",
      "title": "HTTP file",
      "url": "https://cdn.example.com/movie.mp4"
    }
  ]
}`;

const subtitleExample = `GET /subtitles/movie/tt0133093.json

{
  "subtitles": [
    {
      "id": "en-1",
      "url": "https://cdn.example.com/movie-en.vtt",
      "lang": "eng",
      "label": "English"
    }
  ]
}`;

function GuideCode({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="landing-guide-code">
      <div className="landing-guide-code-bar">
        <span>{label}</span>
        <button type="button" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{value}</code>
      </pre>
    </div>
  );
}

export function AddonGuideSection({ copy }: AddonGuideSectionProps) {
  return (
    <section
      className="landing-addon-guide"
      id="addon-guide"
      aria-labelledby="addon-guide-title"
    >
      <div className="landing-addon-guide-header landing-scroll-reveal">
        <span className="landing-eyebrow">{copy.eyebrow}</span>
        <h2 id="addon-guide-title">{copy.title}</h2>
        <p>{copy.description}</p>
      </div>

      <div className="landing-guide-layout landing-scroll-reveal landing-scroll-reveal-delay-one">
        <div className="landing-guide-intro">
          <div className="landing-guide-number">01</div>
          <h3>{copy.manifestTitle}</h3>
          <p>{copy.manifestDescription}</p>
          <GuideCode value={manifestExample} label="manifest.json" />
        </div>

        <div className="landing-guide-resource-panel">
          <div className="landing-guide-number">02</div>
          <h3>{copy.resourcesTitle}</h3>
          <p>{copy.resourcesDescription}</p>
          <div className="landing-guide-resource-grid">
            {Object.entries(copy.resources).map(([resource, description]) => (
              <article key={resource} className="landing-guide-resource">
                <code>{resource}</code>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </div>

      <div className="landing-guide-examples landing-scroll-reveal landing-scroll-reveal-delay-two">
        <div className="landing-guide-example-copy">
          <div className="landing-guide-number">03</div>
          <h3>{copy.runTitle}</h3>
          <ol>
            {copy.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="landing-guide-advanced">
            <strong>{copy.advancedTitle}</strong>
            <p>{copy.advancedDescription}</p>
            <a
              href="https://github.com/Stremio/stremio-addon-sdk"
              target="_blank"
              rel="noreferrer"
            >
              {copy.advancedLink} <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
        <div className="landing-guide-example-codes">
          <GuideCode value={streamExample} label="/stream" />
          <GuideCode value={subtitleExample} label="/subtitles" />
        </div>
      </div>
    </section>
  );
}
