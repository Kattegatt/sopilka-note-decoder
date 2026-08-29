import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function githubPagesBase() {
  const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
  if (!process.env.GITHUB_ACTIONS || !repository) return "/";
  return repository.endsWith(".github.io") ? "/" : `/${repository}/`;
}

export default defineConfig({
  base: githubPagesBase(),
  plugins: [react()],
  server: {
    port: 3000,
  },
  preview: {
    port: 3000,
  },
});
