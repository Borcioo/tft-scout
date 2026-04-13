<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Emblems are 1:1 with traits (Spatula + X → X Emblem).
        // Extracted from old items table where 783 rows were emblems
        // from multiple historical sets — importer filters to current set only.
        Schema::create('emblems', function (Blueprint $table) {
            $table->id();
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->string('api_name', 100)->unique();
            $table->string('name', 100);
            $table->foreignId('trait_id')->constrained()->cascadeOnDelete();
            $table->string('icon_path', 500)->nullable();
            $table->timestampsTz();

            $table->index('trait_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('emblems');
    }
};
