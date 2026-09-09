import { AppBoundary } from "@table/ui";
import { initializeStoreTheme } from "@table/ui/theme";
import { render } from "solid-js/web";
import { App } from "./App";
import "@table/ui/styles.css";
import "./styles.css";

initializeStoreTheme();
const root = document.getElementById("root");
if (!root) throw new Error("Application root missing");
render(
  () => (
    <AppBoundary>
      <App />
    </AppBoundary>
  ),
  root,
);
