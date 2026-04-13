<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('meta_comps', function (Blueprint $table) {
            // external_id is the MetaTFT-provided stable cluster identifier
            $table->string('external_id', 100)->nullable()->unique()->after('id');
            // level: recommended level for the comp (from MetaTFT levelling data)
            $table->unsignedTinyInteger('level')->default(8)->after('games');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('meta_comps', function (Blueprint $table) {
            $table->dropUnique(['external_id']);
            $table->dropColumn(['external_id', 'level']);
        });
    }
};
