import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import { ServiceWorkerRegistration } from "./ServiceWorkerRegistration";
import { SopilkaApp } from "./SopilkaApp";

const root = document.getElementById("root");

if (!root) throw new Error("Не знайдено кореневий елемент застосунку.");

createRoot(root).render(
  <StrictMode>
    <SopilkaApp />
    <ServiceWorkerRegistration />
  </StrictMode>,
);
