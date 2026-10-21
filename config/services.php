<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'tft' => [
        'set' => (int) env('TFT_SET', 18),
    ],

    // Local debug sidecar (tmp/scout-lab/runs.db). `node` is resolved from
    // PATH unless SCOUT_LAB_NODE points at the binary — web servers
    // (Herd's php-cgi, php -S) often run with a PATH that lacks it.
    'scout_lab' => [
        'enabled' => (bool) env('SCOUT_LAB_ENABLED', false),
        'node' => env('SCOUT_LAB_NODE'),
    ],

    'cdragon' => [
        'channel' => env('CDRAGON_CHANNEL', 'latest'),
    ],

    'metatft' => [
        'queue' => env('METATFT_QUEUE', '1100'),
        // Newest patch is used once it has this many games in the 2-day
        // window; until then the previous patch (MetaTFT site behaves
        // the same right after a release: 18.5 had 22k games, 18.4b 25M).
        'min_patch_games' => (int) env('METATFT_MIN_PATCH_GAMES', 300000),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
