// Serves the public-menu service worker at /menu/serwist/sw.js.
//
// Turbopack cannot emit a worker bundle during `next build`, so Serwist builds
// it with esbuild inside this static route handler at build time (the route is
// force-static and prerendered). Keeping it under /menu means the worker's
// natural scope and its registration scope ('/menu') line up; the handler also
// sends Service-Worker-Allowed so the scope may sit above the script path.
//
// Precache manifest: only the menu's own static assets. The admin app's
// chunks are deliberately NOT precached — /_next/static is cached at runtime
// by the worker as the menu page actually references files.
import { createSerwistRoute } from '@serwist/turbopack';

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
    swSrc: 'src/app/menu/sw.ts',
    globPatterns: ['public/menu/**/*.png', 'public/menu-manifest.webmanifest'],
    // esbuild-wasm is not installed; the native binary is (a devDependency).
    useNativeEsbuild: true,
});
