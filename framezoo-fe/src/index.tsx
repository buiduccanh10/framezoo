import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/assets/css/index.css";
import App from "@/setup/App";

const container = document.getElementById("root");

if (!container) {
  throw new Error("FrameZoo landing root was not found.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
