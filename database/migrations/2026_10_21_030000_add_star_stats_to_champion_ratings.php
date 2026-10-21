<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A unit's placement split by star level, plus how many of its 3-item
     * games were at each star: the scout rates units at 1–2★ and builds
     * reroll plans from the 3★ numbers (see strength.ts).
     */
    public function up(): void
    {
        Schema::table('champion_ratings', function (Blueprint $table) {
            $table->jsonb('star_stats')->nullable()->after('score');
        });
    }

    public function down(): void
    {
        Schema::table('champion_ratings', function (Blueprint $table) {
            $table->dropColumn('star_stats');
        });
    }
};
