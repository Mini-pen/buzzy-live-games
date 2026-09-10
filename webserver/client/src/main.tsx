import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "./styles/buzzy.css";

// * Vite's BASE_URL is `/` or `/buzzy-live-games/`; React Router wants it without
//   the trailing slash (and `/` means "no base").
const routerBasename = import.meta.env.BASE_URL.replace(/\/+$/u, "") || "/";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
