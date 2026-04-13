import inertia from '@inertiajs/vite';
import { wayfinder } from '@laravel/vite-plugin-wayfinder';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import laravel from 'laravel-vite-plugin';
import { defineConfig } from 'vite';

// Herd serves the app on https://tft-scout.test (443). Vite's dev
// server runs on :5173. Module workers (`new Worker(url, { type:
// 'module' })`) require either a same-origin script URL or a
// cross-origin response with `Access-Control-Allow-Origin` headers.
// Setting `server.cors: true` makes Vite emit permissive CORS headers
// on every asset so the browser accepts the cross-port worker fetch.
//
// After changing this config, **restart `npm run dev`** — Vite only
// reads server config at startup.
export default defineConfig({
    server: {
        cors: true,
    },
    // `format: 'iife'` bundles the worker into a single self-contained
    // IIFE instead of an ES module. Combined with the `?worker&inline`
    // import in use-scout-worker.ts, this lets Vite produce a blob URL
    // worker in dev mode (not just production), sidestepping the
    // cross-origin SecurityError that hits module workers loaded from
    // Vite's :5173 dev server when the page lives on Herd's :443.
    worker: {
        format: 'iife',
    },
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.tsx'],
            refresh: true,
        }),
        inertia(),
        react({
            babel: {
                plugins: ['babel-plugin-react-compiler'],
            },
        }),
        tailwindcss(),
        wayfinder({
            formVariants: true,
        }),
    ],
});
