<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Top-performing comps from MetaTFT clustering (e.g., "8 Mecha + ASol").
        // Each row is one cluster identified by MetaTFT's cluster_id.
        // active_traits and top_builds are JSONB because they're nested structures
        // (traits with breakpoint+count, builds with champion+items+avg).
        // Champions are normalized into pivot table meta_comp_champions for FK integrity.
        Schema::create('meta_comps', function (Blueprint $table) {
            $table->id();
            $table->string('cluster_id', 50)->unique();
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->string('name', 255); // auto-generated label from MetaTFT
            $table->jsonb('active_traits')->default('[]');
            // ^ [{trait_id, breakpoint_position, count}, ...]
            $table->string('levelling', 50)->nullable(); // "Fast 8", "Slow Roll 7", etc.
            $table->jsonb('top_builds')->default('[]');
            // ^ [{champion_id, items: [], avg}, ...]
            $table->float('avg_place');
            $table->integer('games');
            $table->timestampTz('updated_at')->useCurrent();

            $table->index(['set_id', 'avg_place']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('meta_comps');
    }
};
