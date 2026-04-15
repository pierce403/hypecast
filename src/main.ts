import { registerSW } from "virtual:pwa-register";

import "./styles.css";
import { createApp } from "./app";

registerSW({ immediate: true });

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("App root not found.");
}

createApp(root);
