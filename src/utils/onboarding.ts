import { isExtensionActive } from "@/backend/extension/messaging";
import { useAuthStore } from "@/stores/auth";
import { useOnboardingStore } from "@/stores/onboarding";

export async function needsOnboarding(): Promise<boolean> {
  // if extension is not active and working, onboarding is needed
  const extensionActive = await isExtensionActive();
  if (extensionActive) return false;
  // if there is any custom proxy urls, no onboarding needed
  const proxyUrls = useAuthStore.getState().proxySet;
  if (proxyUrls) return false;

  // if onboarding has been completed (i.e., user chose default proxy), no onboarding needed
  const completed = useOnboardingStore.getState().completed;
  if (completed) return false;

  return true;
}
