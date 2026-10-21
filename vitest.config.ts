import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts on purpose: the app config pulls in the
// Laravel + Wayfinder plugins (the latter shells out to `php artisan`),
// which unit tests of pure TS modules don't need.
export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./resources/js', import.meta.url)),
        },
    },
    test: {
        include: ['resources/js/**/*.test.ts'],
        environment: 'node',
    },
});
