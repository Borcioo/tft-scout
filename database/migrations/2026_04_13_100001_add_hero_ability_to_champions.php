<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Adds a nullable `hero_ability` JSONB column that mirrors the shape
     * of the existing `ability_desc` / `ability_stats` pair but for the
     * champion's Hero Augment variant spell.
     *
     * Several TFT17 champions (Aatrox "Stellar Combo", other DRX units)
     * ship a second SpellObject in the same character bin alongside
     * their primary — typically named `{primary}Hero`. It carries a
     * fully separate template, DataValues, and calculations, often with
     * mechanics that the base spell doesn't have (Aatrox's rotating
     * Strike/Sweep/Slam stance).
     *
     * We store the entire hero ability blob as a single JSONB object
     * rather than three parallel columns because it's always read as a
     * unit on the detail page and never queried by the fields inside.
     *
     * Shape:
     *   {
     *     "name": "Stellar Combo",
     *     "desc":  "<template with @placeholders@...>",
     *     "stats": [
     *       {"name": "StrikeDamage", "value": [...]},
     *       {"name": "ModifiedStrikeDamage", "value": [...], "kind": "calculated"},
     *       ...
     *     ]
     *   }
     */
    public function up(): void
    {
        Schema::table('champions', function (Blueprint $table) {
            $table->jsonb('hero_ability')->nullable()->after('ability_stats');
        });
    }

    public function down(): void
    {
        Schema::table('champions', function (Blueprint $table) {
            $table->dropColumn('hero_ability');
        });
    }
};
