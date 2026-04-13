<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // "How well does champion X perform when trait Y is active at breakpoint N?"
        // Used by scout to prioritize champion-trait pairings.
        // One row per (champion × trait × breakpoint).
        Schema::create('champion_trait_affinity', function (Blueprint $table) {
            $table->id();
            $table->foreignId('champion_id')->constrained()->cascadeOnDelete();
            $table->foreignId('trait_id')->constrained('traits')->cascadeOnDelete();
            $table->smallInteger('breakpoint_position');
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->float('avg_place');
            $table->integer('games');
            $table->float('frequency'); // how often champ appears with this trait/bp
            $table->timestampTz('updated_at')->useCurrent();

            $table->unique(['champion_id', 'trait_id', 'breakpoint_position'], 'cta_unique');
            $table->index('champion_id');
            $table->index('trait_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('champion_trait_affinity');
    }
};
