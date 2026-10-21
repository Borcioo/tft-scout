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
        // Newest patch is used once it has this many games in the
        // window; until then the previous patch (MetaTFT site behaves
        // the same right after a release: 18.5 had 22k games, 18.4b 25M).
        'min_patch_games' => (int) env('METATFT_MIN_PATCH_GAMES', 300000),
        // Rank tiers sampled: Emerald+ over 7 days of one patch (18.4b:
        // 8.5M games, 1.3× Gold+ over 2 days). Against real outcomes it
        // ranks Master+ boards and the top 200's games better than Gold+
        // (docs/research/scout-strength-model.md, "Dane: Emerald+").
        'rank' => env('METATFT_RANK', 'EMERALD,DIAMOND,MASTER,GRANDMASTER,CHALLENGER'),
        // Window in days, the same for every endpoint; every endpoint is
        // pinned to one patch, so a longer window adds that patch's games
        'days' => (int) env('METATFT_DAYS', 7),
        // Pin a patch ("18.4b") instead of resolving the newest — for
        // rebuilding a snapshot of a past patch; empty in production
        'patch' => env('METATFT_PATCH', ''),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
