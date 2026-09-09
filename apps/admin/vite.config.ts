import tailwind from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
export default defineConfig({
  base: "/admin/",
  plugins: [solid(), tailwind()],
  server: { proxy: { "/api": "http://127.0.0.1:3000", "/uploads": "http://127.0.0.1:3000" } },
});
