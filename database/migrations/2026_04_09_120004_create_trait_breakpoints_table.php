<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trait_breakpoints', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trait_id')->constrained('traits')->cascadeOnDelete();
            $table->smallInteger('position');
            $table->smallInteger('min_units');
            $table->smallInteger('max_units');

            // Explicit unsignedSmallInteger (NOT foreignId) because trait_styles.id
            // is also unsignedSmallInteger — type must match for FK constraint.
            $table->unsignedSmallInteger('style_id');
            $table->foreign('style_id')->references('id')->on('trait_styles');

            $table->jsonb('effects')->default('{}');

            $table->unique(['trait_id', 'position']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trait_breakpoints');
    }
};
