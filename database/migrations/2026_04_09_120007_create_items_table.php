<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('items', function (Blueprint $table) {
            $table->id();
            // Nullable set_id: base items (TFT_Item_*) are cross-set, set-specific
            // items (TFT17_Item_*) have set_id. Importer decides which filter applies.
            $table->foreignId('set_id')->nullable()->constrained()->nullOnDelete();
            $table->string('api_name', 100)->unique();
            $table->string('name', 100);
            // type differentiates 5 item categories previously mixed in old items table:
            //   "base"       → TFT_Item_* (Bloodthirster, Infinity Edge)
            //   "craftable"  → set-specific 2-component combines
            //   "radiant"    → upgraded versions from Radiant mechanic
            //   "support"    → support items
            //   "artifact"   → artifact items
            $table->string('type', 20);
            $table->string('tier', 20)->nullable();

            // Self-FK for recipes: item composed of two components.
            // nullOnDelete because components are other items, cascading would
            // delete the recipe holder which we don't want.
            $table->unsignedBigInteger('component_1_id')->nullable();
            $table->unsignedBigInteger('component_2_id')->nullable();

            $table->jsonb('effects')->default('{}');
            // tags text[] added via raw DDL below — Laravel Schema Builder
            // doesn't support Postgres native array types.

            $table->string('icon_path', 500)->nullable();
            $table->timestampsTz();

            $table->index('type');
            $table->index('component_1_id');
            $table->index('component_2_id');

            $table->foreign('component_1_id')->references('id')->on('items')->nullOnDelete();
            $table->foreign('component_2_id')->references('id')->on('items')->nullOnDelete();
        });

        // Postgres native text[] for tags — filtered at import time to exclude
        // {hex} translation keys, keeping only human-readable tags like
        // "AttackDamage", "Health", "Mana", "AbilityPower" etc.
        // GIN index enables fast filtering: WHERE 'AttackDamage' = ANY(tags)
        DB::statement("ALTER TABLE items ADD COLUMN tags text[] NOT NULL DEFAULT '{}'::text[]");
        DB::statement('CREATE INDEX items_tags_gin ON items USING GIN (tags)');
    }

    public function down(): void
    {
        Schema::dropIfExists('items');
    }
};
