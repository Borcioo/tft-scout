<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Pivot M:N for meta_comps ↔ champions with extra columns.
        // Enables fast lookup: "show all meta comps using Aatrox".
        Schema::create('meta_comp_champions', function (Blueprint $table) {
            $table->foreignId('meta_comp_id')->constrained()->cascadeOnDelete();
            $table->foreignId('champion_id')->constrained()->cascadeOnDelete();
            $table->smallInteger('star_level')->nullable(); // if MetaTFT reports it
            $table->boolean('is_carry')->default(false);    // has recommended items in top_builds

            $table->primary(['meta_comp_id', 'champion_id']);
            $table->index('champion_id'); // reverse lookup: "comps with this champ"
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('meta_comp_champions');
    }
};
