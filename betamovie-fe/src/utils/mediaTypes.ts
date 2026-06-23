export interface MediaItem {
  id: string;
  title: string;
  year?: number;
  release_date?: Date;
  poster?: string;
  genreIds?: number[];
  originCountryCodes?: string[];
  type: "show" | "movie";
  onHoverInfoEnter?: () => void;
  onHoverInfoLeave?: () => void;
}
