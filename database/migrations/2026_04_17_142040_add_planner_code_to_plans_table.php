<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Adds TFT Team Planner code as a dedup key for saved plans.
     *
     * Format: "02" + 10×3hex + "TFTSet<N>" (pasted into TFT in-game planner).
     * Computed from the list of champions, so two plans with the same units
     * produce the same code — perfect as idempotency / dedup key.
     *
     * Unique per user: the same user can't save the same comp twice, but
     * different users can save the same comp independently.
     */
    public function up(): void
    {
        Schema::table('plans', function (Blueprint $table) {
            $table->string('planner_code', 64)->nullable()->after('slots');
            $table->unique(['user_id', 'planner_code'], 'plans_user_planner_code_unique');
        });
    }

    public function down(): void
    {
        Schema::table('plans', function (Blueprint $table) {
            $table->dropUnique('plans_user_planner_code_unique');
            $table->dropColumn('planner_code');
        });
    }
};
