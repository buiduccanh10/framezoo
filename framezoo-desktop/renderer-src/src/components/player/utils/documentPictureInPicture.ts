const STYLE_MARKER_ATTR = "data-framezoo-document-pip-styles";
const ROOT_ID = "framezoo-document-pip-root";
const VIDEO_ROOT_ID = "framezoo-document-pip-video-root";
const OVERLAY_ROOT_ID = "framezoo-document-pip-overlay-root";
const SUBTITLE_ROOT_ID = "framezoo-document-pip-subtitle-root";

export interface DocumentPictureInPictureRoots {
  root: HTMLDivElement;
  videoRoot: HTMLDivElement;
  overlayRoot: HTMLDivElement;
  subtitleRoot: HTMLDivElement;
}

function applyStyles(
  element: HTMLElement,
  styles: Partial<CSSStyleDeclaration>,
) {
  Object.assign(element.style, styles);
}

function ensureRootElement(
  documentRef: Document,
  id: string,
  styles: Partial<CSSStyleDeclaration>,
) {
  let element = documentRef.getElementById(id) as HTMLDivElement | null;

  if (!element) {
    element = documentRef.createElement("div");
    element.id = id;
    documentRef.body.appendChild(element);
  }

  applyStyles(element, styles);
  return element;
}

function copyDocumentStyleSheets(targetDocument: Document) {
  if (targetDocument.head.querySelector(`[${STYLE_MARKER_ATTR}]`)) return;

  const marker = targetDocument.createElement("meta");
  marker.setAttribute(STYLE_MARKER_ATTR, "true");
  targetDocument.head.appendChild(marker);

  [...document.styleSheets].forEach((styleSheet) => {
    try {
      const style = targetDocument.createElement("style");
      style.textContent = [...styleSheet.cssRules]
        .map((rule) => rule.cssText)
        .join("\n");
      targetDocument.head.appendChild(style);
    } catch {
      const href = styleSheet.href;
      if (!href) return;

      const link = targetDocument.createElement("link");
      link.rel = "stylesheet";
      link.href = href;

      const mediaText = styleSheet.media?.mediaText;
      if (mediaText) {
        link.media = mediaText;
      }

      targetDocument.head.appendChild(link);
    }
  });
}

export function ensureDocumentPictureInPictureRoots(
  pipWindow: Window,
): DocumentPictureInPictureRoots {
  const documentRef = pipWindow.document;
  documentRef.title = document.title;
  copyDocumentStyleSheets(documentRef);

  applyStyles(documentRef.documentElement, {
    width: "100%",
    height: "100%",
    backgroundColor: "black",
    overflow: "hidden",
  });
  applyStyles(documentRef.body, {
    margin: "0",
    width: "100vw",
    height: "100vh",
    backgroundColor: "black",
    overflow: "hidden",
  });

  const root = ensureRootElement(documentRef, ROOT_ID, {
    position: "relative",
    width: "100vw",
    height: "100vh",
    backgroundColor: "black",
    overflow: "hidden",
    isolation: "isolate",
  });
  const videoRoot = ensureRootElement(documentRef, VIDEO_ROOT_ID, {
    position: "absolute",
    inset: "0",
    backgroundColor: "black",
  });
  const overlayRoot = ensureRootElement(documentRef, OVERLAY_ROOT_ID, {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "auto",
    zIndex: "2",
  });
  const subtitleRoot = ensureRootElement(documentRef, SUBTITLE_ROOT_ID, {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "1",
  });

  if (root.firstElementChild !== videoRoot) {
    root.appendChild(videoRoot);
  }
  if (overlayRoot.parentElement !== root) {
    root.appendChild(overlayRoot);
  }
  if (subtitleRoot.parentElement !== root) {
    root.appendChild(subtitleRoot);
  }

  return {
    root,
    videoRoot,
    overlayRoot,
    subtitleRoot,
  };
}

export function getDocumentPictureInPictureRoots(pipWindow: Window | null) {
  if (!pipWindow || pipWindow.closed) return null;
  return ensureDocumentPictureInPictureRoots(pipWindow);
}
