import { resolvePublicUrl } from "@/utils/publicUrl";

export function getRTIcon(
  type: "certified_fresh" | "fresh" | "rotten",
): string {
  switch (type) {
    case "certified_fresh":
      return resolvePublicUrl("/tomatoes/Certified_Fresh.svg")!;
    case "fresh":
      return resolvePublicUrl("/tomatoes/Fresh.svg")!;
    case "rotten":
      return resolvePublicUrl("/tomatoes/Rotten.svg")!;
    default:
      return resolvePublicUrl("/tomatoes/Rotten.svg")!;
  }
}
