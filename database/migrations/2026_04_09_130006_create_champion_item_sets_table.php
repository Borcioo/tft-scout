<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 3-item build combinations per champion (e.g., BT + Titans + Runaan).
        // item_api_names stays as text[] (not FK pivot) because the combination
        // is an atomic value — we care about the specific 3-item SET as a whole
        // stat, not individual items. Items can still be looked up via api_name
        // against items table when rendering.
        Schema::create('champion_item_sets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('champion_id')->constrained()->cascadeOnDelete();
            // item_api_names text[] added via raw DDL after Schema::create
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->float('avg_place');
            $table->integer('games');
            $table->timestampTz('updated_at')->useCurrent();

            $table->index('champion_id');
        });

        // Postgres native text[] with GIN index for "find sets containing item X" queries
        DB::statement("ALTER TABLE champion_item_sets ADD COLUMN item_api_names text[] NOT NULL DEFAULT '{}'::text[]");
        DB::statement('CREATE INDEX champion_item_sets_items_gin ON champion_item_sets USING GIN (item_api_names)');
    }

    public function down(): void
    {
        Schema::dropIfExists('champion_item_sets');
    }
};
