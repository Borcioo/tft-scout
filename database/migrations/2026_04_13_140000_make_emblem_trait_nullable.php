<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Random Emblem (TFT17_MarketOffering_RandomEmblem) grants a
        // randomly-picked trait at equip time, so it has no fixed trait
        // reference. Nullable trait_id lets us represent it without a
        // fake/placeholder trait row.
        Schema::table('emblems', function (Blueprint $table) {
            $table->unsignedBigInteger('trait_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('emblems', function (Blueprint $table) {
            $table->unsignedBigInteger('trait_id')->nullable(false)->change();
        });
    }
};
