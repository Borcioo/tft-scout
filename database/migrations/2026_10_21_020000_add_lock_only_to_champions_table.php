<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Units the scout fields only when the player locks them — e.g. a
     * Kha'Zix with all four evolutions: legal, but rarely reached, so it
     * must not be assumed for every comp.
     */
    public function up(): void
    {
        Schema::table('champions', function (Blueprint $table) {
            $table->boolean('lock_only')->default(false)->after('is_playable');
        });
    }

    public function down(): void
    {
        Schema::table('champions', function (Blueprint $table) {
            $table->dropColumn('lock_only');
        });
    }
};
