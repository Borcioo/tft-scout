<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Stores a snapshot of the Scout output at save time: score,
     * activeTraits, roles, insights. Lets Plans/Index render the same
     * rich card as Scout without re-running the algorithm.
     *
     * Snapshot rationale: score depends on the parameters used at save
     * time (level, locks, emblems); re-computing later against different
     * params would produce misleading numbers. What the user saved is
     * what we show.
     */
    public function up(): void
    {
        Schema::table('plans', function (Blueprint $table) {
            $table->jsonb('meta')->nullable()->after('planner_code');
        });
    }

    public function down(): void
    {
        Schema::table('plans', function (Blueprint $table) {
            $table->dropColumn('meta');
        });
    }
};
