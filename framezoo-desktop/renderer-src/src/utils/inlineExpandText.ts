export interface InlineExpandableTextResult {
  isTruncated: boolean;
  text: string;
}

function getLineHeight(style: CSSStyleDeclaration): number {
  const parsedLineHeight = parseFloat(style.lineHeight);
  if (Number.isFinite(parsedLineHeight)) return parsedLineHeight;

  const parsedFontSize = parseFloat(style.fontSize);
  if (Number.isFinite(parsedFontSize)) return parsedFontSize * 1.25;

  return 20;
}

export function measureInlineExpandableText(
  element: HTMLElement,
  fullText: string,
  suffixText: string,
  maxLines = 2,
): InlineExpandableTextResult {
  const normalizedText = fullText.replace(/\s+/g, " ").trim();
  if (!normalizedText) {
    return { isTruncated: false, text: normalizedText };
  }

  const width = element.clientWidth || element.getBoundingClientRect().width;
  if (!width || typeof document === "undefined") {
    return { isTruncated: false, text: normalizedText };
  }

  const computedStyle = window.getComputedStyle(element);
  const maxHeight = getLineHeight(computedStyle) * maxLines + 0.5;
  const measurer = document.createElement("div");

  Object.assign(measurer.style, {
    position: "fixed",
    left: "-9999px",
    top: "0",
    visibility: "hidden",
    pointerEvents: "none",
    zIndex: "-1",
    width: `${width}px`,
    boxSizing: "border-box",
    margin: "0",
    padding: "0",
    border: "0",
    font: computedStyle.font,
    fontFamily: computedStyle.fontFamily,
    fontSize: computedStyle.fontSize,
    fontWeight: computedStyle.fontWeight,
    fontStyle: computedStyle.fontStyle,
    letterSpacing: computedStyle.letterSpacing,
    lineHeight: computedStyle.lineHeight,
    whiteSpace: "normal",
    wordBreak: computedStyle.wordBreak,
    overflowWrap: computedStyle.overflowWrap,
  });

  document.body.appendChild(measurer);

  const fits = (text: string) => {
    measurer.textContent = text;
    return measurer.scrollHeight <= maxHeight;
  };

  try {
    if (fits(normalizedText)) {
      return { isTruncated: false, text: normalizedText };
    }

    const suffix = `... ${suffixText}`;
    let low = 0;
    let high = normalizedText.length;
    let best = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = normalizedText.slice(0, mid).trimEnd();

      if (fits(`${candidate}${suffix}`)) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    let fittedText = normalizedText.slice(0, best).trimEnd();
    const wordBoundaryText = fittedText.replace(/\s+\S*$/, "").trimEnd();

    if (wordBoundaryText && fits(`${wordBoundaryText}${suffix}`)) {
      fittedText = wordBoundaryText;
    } else {
      while (fittedText.length > 0 && !fits(`${fittedText}${suffix}`)) {
        fittedText = fittedText.slice(0, -1).trimEnd();
      }
    }

    return {
      isTruncated: true,
      text: fittedText,
    };
  } finally {
    measurer.remove();
  }
}
