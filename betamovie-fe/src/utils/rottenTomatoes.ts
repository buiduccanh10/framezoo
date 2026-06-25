export function getRTIcon(
  type: "certified_fresh" | "fresh" | "rotten",
): string {
  switch (type) {
    case "certified_fresh":
      return "/tomatoes/Certified_Fresh.svg";
    case "fresh":
      return "/tomatoes/Fresh.svg";
    case "rotten":
      return "/tomatoes/Rotten.svg";
    default:
      return "/tomatoes/Rotten.svg";
  }
}
