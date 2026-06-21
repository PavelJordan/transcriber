import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  document.documentElement.classList.toggle("dark", darkScheme.matches);
}
applyTheme();
darkScheme.addEventListener("change", applyTheme);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
