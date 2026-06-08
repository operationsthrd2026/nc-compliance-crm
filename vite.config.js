import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // --- Build output ---
  build: {
    outDir:         "dist",
    sourcemap:      false,
    minify:         "esbuild",
    chunkSizeWarningLimit: 1200,   // xlsx is large — suppress the warning
    rollupOptions: {
      output: {
        // Split xlsx into its own chunk so the main bundle stays lean
        manualChunks: {
          xlsx:  ["xlsx"],
          react: ["react", "react-dom"],
        },
      },
    },
  },

  // --- Dev server ---
  server: {
    port:        3000,
    open:        true,
    strictPort:  false,
  },

  // --- Preview server (after `npm run build`) ---
  preview: {
    port: 4173,
    open: true,
  },

  // --- Environment variables ---
  // All VITE_* variables in .env are injected into import.meta.env at build time.
  // Never prefix secret server-side values with VITE_ — they become public.
  envPrefix: "VITE_",

  // --- Path aliases (optional convenience) ---
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
