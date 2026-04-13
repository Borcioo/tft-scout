<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Classic Laravel M:N pivot for champion ↔ trait.
        // Decision #4 → A: pivot over text[] for Eloquent belongsToMany idiomaticness
        // and future extensibility (can add metadata columns without array migration).
        Schema::create('champion_trait', function (Blueprint $table) {
            $table->foreignId('champion_id')->constrained()->cascadeOnDelete();
            $table->foreignId('trait_id')->constrained()->cascadeOnDelete();

            $table->primary(['champion_id', 'trait_id']);
            $table->index('trait_id'); // reverse lookup: "all champions with trait X"
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('champion_trait');
    }
};
