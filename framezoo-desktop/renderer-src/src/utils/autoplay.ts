import { conf } from "@/setup/config";

export function isAutoplayAllowed() {
  return Boolean(conf().ALLOW_AUTOPLAY);
}
