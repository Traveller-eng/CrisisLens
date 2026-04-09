import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("firebase")) {
            return "firebase";
          }

          if (id.includes("react")) {
            return "react-vendor";
          }

          if (id.includes("LiveMap")) {
            return "maps";
          }
        }
      }
    }
  }
});
