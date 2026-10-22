import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles/theme.css";
import "./styles/modern.css";
import "./styles/pf-palette.css";
import { initTheme } from "./ui/theme.js";

initTheme(); // sets <html data-theme> immediately (no flash)

// Mount the application
const container = document.getElementById("root");
const root = createRoot(container);

root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
