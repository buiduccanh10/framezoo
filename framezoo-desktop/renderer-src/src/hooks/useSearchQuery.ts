import { useCallback, useEffect, useState } from "react";
import {
  generatePath,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

function decode(query: string | null | undefined) {
  return query ? decodeURIComponent(query) : "";
}

export function useSearchQuery(): [
  string,
  (inp: string, force?: boolean) => void,
  (newSearch?: string) => void,
  boolean,
  (aiMode: boolean) => void,
] {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ query: string }>();
  const [search, setSearch] = useState(decode(params.query));
  const aiMode = new URLSearchParams(location.search).get("mode") === "ai";

  useEffect(() => {
    setSearch(decode(params.query));
  }, [params.query]);

  const navigateWithMode = useCallback(
    (inp: string, nextAiMode: boolean) => {
      const searchSuffix = nextAiMode ? "?mode=ai" : "";
      if (inp.length === 0) {
        navigate(`/browse${searchSuffix}`, { replace: true });
        return;
      }
      navigate(
        `${generatePath("/browse/:query", {
          query: encodeURIComponent(inp),
        })}${searchSuffix}`,
        { replace: true },
      );
    },
    [navigate],
  );

  const updateParams = useCallback(
    (inp: string, commitToUrl = false) => {
      setSearch(inp);
      if (!commitToUrl) return;
      navigateWithMode(inp, aiMode);
    },
    [aiMode, navigateWithMode],
  );

  const onUnFocus = useCallback(
    (newSearch?: string) => {
      updateParams(newSearch ?? search, true);
    },
    [search, updateParams],
  );

  const setAiMode = useCallback(
    (nextAiMode: boolean) => {
      navigateWithMode(search, nextAiMode);
    },
    [navigateWithMode, search],
  );

  return [search, updateParams, onUnFocus, aiMode, setAiMode];
}
