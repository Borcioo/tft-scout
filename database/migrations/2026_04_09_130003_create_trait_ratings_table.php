<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Per-trait-per-breakpoint ratings: "how good is Vanguard at 4 units vs 6".
        // Each (trait, breakpoint_position) row is a distinct activation tier.
        Schema::create('trait_ratings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trait_id')->constrained('traits')->cascadeOnDelete();
            $table->smallInteger('breakpoint_position'); // 1, 2, 3 (bronze/silver/gold tier)
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->float('avg_place');
            $table->float('win_rate');
            $table->float('top4_rate');
            $table->integer('games');
            $table->float('score');
            $table->timestampTz('updated_at')->useCurrent();

            $table->unique(['trait_id', 'breakpoint_position']);
            $table->index(['set_id', 'score']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trait_ratings');
    }
};
