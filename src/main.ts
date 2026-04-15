import { registerSW } from "virtual:pwa-register";

import "./styles.css";
import { createApp } from "./app";

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    void updateSW(true);
  }
});

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("App root not found.");
}

createApp(root);
