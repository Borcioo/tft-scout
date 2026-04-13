<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Single-item popularity per champion. One row per (champion × item).
        // Used for "top items on Aatrox" tooltips and scout scoring.
        Schema::create('champion_item_builds', function (Blueprint $table) {
            $table->id();
            $table->foreignId('champion_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->cascadeOnDelete();
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->float('avg_place');
            $table->integer('games');
            $table->float('frequency');
            $table->timestampTz('updated_at')->useCurrent();

            $table->unique(['champion_id', 'item_id']);
            $table->index('champion_id');
            $table->index('item_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('champion_item_builds');
    }
};
