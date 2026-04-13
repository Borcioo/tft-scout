<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Per-champion MetaTFT aggregates (avg place, winrate, top4, games).
        // Decision #3 → B: real FK to champions.id (not soft api_name ref).
        // Decision #3a → A: base Miss Fortune stays in champions with
        //                   is_playable=false, so FK integrity is preserved
        //                   for MetaTFT aggregates that target base MF.
        Schema::create('champion_ratings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('champion_id')->constrained()->cascadeOnDelete();
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->string('patch', 20)->nullable(); // "14.3" if MetaTFT provides it
            $table->float('avg_place');
            $table->float('win_rate');
            $table->float('top4_rate');
            $table->integer('games');
            $table->float('score'); // (6 - avg_place) / 3, clamped [0, 1]
            $table->timestampTz('updated_at')->useCurrent();

            // Unique per (champion, patch) — allows historical patch tracking
            $table->unique(['champion_id', 'patch']);
            $table->index(['set_id', 'score']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('champion_ratings');
    }
};
