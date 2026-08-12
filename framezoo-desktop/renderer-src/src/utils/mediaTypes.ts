export interface MediaItem {
  id: string;
  title: string;
  year?: number;
  release_date?: Date;
  releaseQuality?: "CAM" | "HD" | null;
  poster?: string;
  genreIds?: number[];
  originCountryCodes?: string[];
  type: "show" | "movie";
  onHoverInfoEnter?: () => void;
  onHoverInfoLeave?: () => void;
}
