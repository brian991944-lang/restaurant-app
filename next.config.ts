import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
// Public-menu service worker (src/app/menu/serwist/[path]/route.ts). This
// wrapper only marks esbuild as a server-external package; nothing else in
// the build changes.
import { withSerwist } from "@serwist/turbopack";

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default withNextIntl(withSerwist(nextConfig));
