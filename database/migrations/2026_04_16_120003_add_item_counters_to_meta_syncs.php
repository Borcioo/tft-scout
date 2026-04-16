<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('meta_syncs', function (Blueprint $table) {
            $table->integer('item_stats_count')->default(0);
            $table->integer('item_builds_count')->default(0);
            $table->integer('failed_item_champions')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('meta_syncs', function (Blueprint $table) {
            $table->dropColumn(['item_stats_count', 'item_builds_count', 'failed_item_champions']);
        });
    }
};
