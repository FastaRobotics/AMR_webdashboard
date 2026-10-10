import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    /**
     * Watch only the sources.
     *
     * The default watcher covers the whole project directory, which includes
     * `dist/` and the gitignored `.tmp/` scratch space (browser-verification
     * scripts and screenshots). Watching those adds nothing — neither is an
     * input to the dev server — and a file being written there at the wrong
     * moment can make Node's watcher emit `EBUSY`, which takes the dev server
     * down with it.
     */
    watch: {
      ignored: [
        "**/dist/**",
        "**/.tmp/**",
        "**/node_modules/**",
        "**/.*.tmpdir/**",
      ],
    },
  },
});
