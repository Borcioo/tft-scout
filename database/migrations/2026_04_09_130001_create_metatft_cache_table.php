<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Transparent cache layer for MetaTFT API responses.
        // Each (endpoint, paramsHash) is a unique cache key with a TTL.
        // Stale data is returned immediately while background refresh fetches
        // fresh copy — avoids blocking UI on slow MetaTFT queries.
        Schema::create('metatft_cache', function (Blueprint $table) {
            $table->id();
            $table->string('endpoint', 50);
            $table->string('params_hash', 16); // sha256 slice — stable across runs
            $table->jsonb('params');           // original params for debug/refresh
            $table->jsonb('data');             // raw API response
            $table->timestampTz('fetched_at');
            $table->integer('ttl_seconds');

            $table->unique(['endpoint', 'params_hash']);
            $table->index(['endpoint', 'fetched_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('metatft_cache');
    }
};
