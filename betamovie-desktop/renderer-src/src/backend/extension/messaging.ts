import {
  MessagesMetadata,
  sendToBackgroundViaRelay,
} from "@plasmohq/messaging";

import { isAllowedExtensionVersion } from "@/backend/extension/compatibility";
import { ExtensionMakeRequestResponse } from "@/backend/extension/plasmo";

export const RULE_IDS = {
  PREPARE_STREAM: 1,
  SET_DOMAINS_HLS: 2,
  SET_DOMAINS_HLS_AUDIO: 3,
};

// for some reason, about 500 ms is needed after
// page load before the extension starts responding properly
const isExtensionReady = new Promise<void>((resolve) => {
  setTimeout(() => {
    resolve();
  }, 500);
});

const DEFAULT_MESSAGE_TIMEOUT_MS = 15_000;

let activeExtension = false;

function isDesktopBridgeAvailable() {
  return Boolean(
    typeof window !== "undefined" &&
    (window as any).__ALPHAFLIX_DESKTOP__ &&
    typeof (window as any).electronAPI?.sendExtensionMessage === "function",
  );
}

async function sendMessage<MessageKey extends keyof MessagesMetadata>(
  message: MessageKey,
  payload: MessagesMetadata[MessageKey]["req"] | undefined = undefined,
  timeout: number = -1,
) {
  await isExtensionReady;
  return new Promise<MessagesMetadata[MessageKey]["res"] | null>((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: MessagesMetadata[MessageKey]["res"] | null) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve(value);
    };

    if (timeout >= 0) {
      timeoutHandle = setTimeout(() => finish(null), timeout);
    }

    if (isDesktopBridgeAvailable()) {
      (window as any).electronAPI
        .sendExtensionMessage(message, payload)
        .then((res: MessagesMetadata[MessageKey]["res"]) => {
          activeExtension = true;
          finish(res);
        })
        .catch(() => {
          activeExtension = false;
          finish(null);
        });
      return;
    }

    sendToBackgroundViaRelay<
      MessagesMetadata[MessageKey]["req"],
      MessagesMetadata[MessageKey]["res"]
    >({
      name: message,
      body: payload,
    })
      .then((res) => {
        activeExtension = true;
        finish(res);
      })
      .catch(() => {
        activeExtension = false;
        finish(null);
      });
  });
}

export async function sendExtensionRequest<T>(
  ops: MessagesMetadata["makeRequest"]["req"],
  timeout = DEFAULT_MESSAGE_TIMEOUT_MS,
): Promise<ExtensionMakeRequestResponse<T> | null> {
  return sendMessage("makeRequest", ops, timeout);
}

export async function setDomainRule(
  ops: MessagesMetadata["prepareStream"]["req"],
): Promise<MessagesMetadata["prepareStream"]["res"] | null> {
  return sendMessage("prepareStream", ops);
}

export async function sendPage(
  ops: MessagesMetadata["openPage"]["req"],
): Promise<MessagesMetadata["openPage"]["res"] | null> {
  return sendMessage("openPage", ops);
}

export async function extensionInfo(): Promise<
  MessagesMetadata["hello"]["res"] | null
> {
  const message = await sendMessage("hello", undefined, 500);
  return message;
}

export function isExtensionActiveCached(): boolean {
  return activeExtension || isDesktopBridgeAvailable();
}

export async function isExtensionActive(): Promise<boolean> {
  const info = await extensionInfo();
  if (!info?.success) return false;
  const allowedVersion = isAllowedExtensionVersion(info.version);
  if (!allowedVersion) return false;
  return info.allowed && info.hasPermission;
}
