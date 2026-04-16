<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('champion_item_sets', function (Blueprint $table) {
            $table->float('win_rate')->default(0);
            $table->float('top4_rate')->default(0);
            $table->float('frequency')->default(0);
            $table->float('place_change')->nullable();
            $table->float('prev_avg_place')->nullable();
            $table->string('tier', 2)->nullable();
            $table->integer('item_count')->default(3);
            $table->timestampTz('synced_at')->nullable();

            $table->index(['champion_id', 'avg_place']);
        });
    }

    public function down(): void
    {
        Schema::table('champion_item_sets', function (Blueprint $table) {
            $table->dropIndex(['champion_id', 'avg_place']);
            $table->dropColumn(['win_rate', 'top4_rate', 'frequency', 'place_change', 'prev_avg_place', 'tier', 'item_count', 'synced_at']);
        });
    }
};
