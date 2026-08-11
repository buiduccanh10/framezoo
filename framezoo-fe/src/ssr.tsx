import { renderToString } from "react-dom/server";

import App from "./setup/App";

export function renderApp(pathname = "/", search = "") {
  return renderToString(<App pathname={pathname} search={search} />);
}
