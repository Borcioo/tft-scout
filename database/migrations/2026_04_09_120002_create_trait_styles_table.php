<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trait_styles', function (Blueprint $table) {
            // Manual PK — CDragon style IDs are fixed (1, 3, 4, 5, 6), not auto-increment
            $table->unsignedSmallInteger('id')->primary();
            $table->string('name', 20)->unique();
            $table->float('fallback_score')->default(0);
            $table->string('color', 10)->nullable();
        });

        // Seed CDragon style IDs inline — these are cross-set constants,
        // never change, and are referenced by trait_breakpoints via FK.
        // fallback_score values come from original Node importer (server/src/db/schema.js).
        DB::table('trait_styles')->insert([
            ['id' => 1, 'name' => 'Bronze',    'fallback_score' => 0.22, 'color' => '#cd7f32'],
            ['id' => 3, 'name' => 'Silver',    'fallback_score' => 0.44, 'color' => '#c0c0c0'],
            ['id' => 4, 'name' => 'Unique',    'fallback_score' => 0.67, 'color' => '#a020f0'],
            ['id' => 5, 'name' => 'Gold',      'fallback_score' => 1.20, 'color' => '#ffd700'],
            ['id' => 6, 'name' => 'Prismatic', 'fallback_score' => 1.50, 'color' => '#b9f2ff'],
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('trait_styles');
    }
};
