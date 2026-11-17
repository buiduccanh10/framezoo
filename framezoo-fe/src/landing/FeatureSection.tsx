import type { LandingCopy } from "./i18n";

interface FeatureSectionProps {
  copy: LandingCopy["features"];
  variant?: "all" | "experience" | "ecosystem";
}

const SHOWCASE_ITEMS = [
  {
    key: "detail",
    rowClassName: "landing-showcase-row-primary",
    figureClassName: "landing-showcase-image-detail",
    gifSrc: "/Snapzy_Recording_2026-11-17_22-40-18.gif",
    mediaFirst: true,
    altKey: "showcasePrimaryAlt",
    titleKey: "showcaseTitle",
    descriptionKey: "showcaseDescription",
  },
  {
    key: "discovery",
    rowClassName: "landing-showcase-row-secondary",
    figureClassName: "landing-showcase-image-discovery",
    gifSrc: "/Snapzy_Recording_2026-11-17_22-41-21.gif",
    mediaFirst: false,
    altKey: "showcaseSecondaryAlt",
    titleKey: "showcaseSecondaryTitle",
    descriptionKey: "showcaseSecondaryDescription",
  },
] as const;

export function FeatureSection({ copy, variant = "all" }: FeatureSectionProps) {
  const showExperience = variant !== "ecosystem";
  const showEcosystem = variant !== "experience";
  const showShowcase = variant !== "experience";

  return (
    <section
      className="landing-features"
      id={variant === "ecosystem" ? "ecosystem-page" : "experience"}
      aria-labelledby={
        variant === "ecosystem" ? "ecosystem-title" : "experience-title"
      }
    >
      {showExperience && (
        <>
          <div className="landing-section-heading landing-reveal landing-reveal-one">
            <span className="landing-eyebrow">{copy.featureLabel}</span>
            <h2 id="experience-title">{copy.experienceTitle}</h2>
            <p>{copy.overviewDescription}</p>
          </div>

          <div className="landing-feature-grid landing-scroll-reveal landing-scroll-reveal-delay-one">
            <article className="landing-feature-card landing-feature-card-sync">
              <div
                className="landing-feature-preview landing-sync-preview"
                aria-hidden="true"
              >
                <div className="landing-preview-toolbar">
                  <span>STREAM</span>
                  <span>SYNC</span>
                </div>
                <div className="landing-sync-track">
                  <span className="landing-sync-marker" />
                  <span className="landing-sync-line" />
                  <span className="landing-sync-line landing-sync-line-short" />
                </div>
                <div className="landing-preview-caption">
                  <span>Dialogue</span>
                  <strong>Matched</strong>
                </div>
              </div>
              <div className="landing-feature-copy">
                <h3>{copy.subtitleSync}</h3>
                <p>{copy.subtitleSyncDescription}</p>
              </div>
            </article>

            <div className="landing-feature-stack">
              <article className="landing-feature-line landing-feature-line-dual">
                <div
                  className="landing-feature-preview landing-dual-preview"
                  aria-hidden="true"
                >
                  <span>EN</span>
                  <span>VI</span>
                </div>
                <div className="landing-feature-copy">
                  <h3>{copy.dualSubtitles}</h3>
                  <p>{copy.dualSubtitlesDescription}</p>
                </div>
              </article>
              <article className="landing-feature-line landing-feature-line-controls">
                <div
                  className="landing-feature-preview landing-controls-preview"
                  aria-hidden="true"
                >
                  <span className="is-active">EN</span>
                  <span>VI</span>
                  <span>Auto</span>
                </div>
                <div className="landing-feature-copy">
                  <h3>{copy.subtitleControls}</h3>
                  <p>{copy.subtitleControlsDescription}</p>
                </div>
              </article>
            </div>
          </div>
        </>
      )}

      {showEcosystem && (
        <div
          className="landing-ecosystem landing-scroll-reveal"
          id="ecosystem"
          aria-labelledby="ecosystem-title"
        >
          <div className="landing-ecosystem-copy">
            <span className="landing-eyebrow">{copy.addonLabel}</span>
            <h2 id="ecosystem-title">{copy.ecosystemTitle}</h2>
            <p>{copy.ecosystemDescription}</p>
          </div>
          <div className="landing-addon-orbit" aria-hidden="true">
            <span className="landing-orbit-ring landing-orbit-ring-one" />
            <span className="landing-orbit-ring landing-orbit-ring-two" />
            <span className="landing-orbit-core">Framezoo</span>
            <span className="landing-addon-tag landing-addon-tag-one">
              {copy.addonOne}
            </span>
            <span className="landing-addon-tag landing-addon-tag-two">
              {copy.addonTwo}
            </span>
            <span className="landing-addon-tag landing-addon-tag-three">
              {copy.addonThree}
            </span>
          </div>
        </div>
      )}

      {showShowcase && (
        <div className="landing-product-showcase landing-scroll-reveal">
          {SHOWCASE_ITEMS.map((item) => {
            const media = (
              <figure
                className={`landing-showcase-image ${item.figureClassName}`}
              >
                <img
                  src={item.gifSrc}
                  alt={copy[item.altKey]}
                  width={959}
                  height={588}
                  loading="lazy"
                  decoding="async"
                />
              </figure>
            );
            const details = (
              <div className="landing-showcase-copy">
                <h2>{copy[item.titleKey]}</h2>
                <p>{copy[item.descriptionKey]}</p>
              </div>
            );

            return (
              <article
                key={item.key}
                className={`landing-showcase-row ${item.rowClassName}`}
              >
                {item.mediaFirst ? (
                  <>
                    {media}
                    {details}
                  </>
                ) : (
                  <>
                    {details}
                    {media}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
