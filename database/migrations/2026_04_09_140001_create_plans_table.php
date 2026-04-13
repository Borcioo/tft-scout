<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // User-owned saved team compositions (planner feature).
        // Decision #5 → C (hybrid): slots stored as JSONB in MVP for minimal
        // boilerplate — one INSERT per save, no child tables. When real usage
        // reveals need for queries like "show all plans using Aatrox", a Phase 2
        // migration will split slots into a relational `plan_slots` table with
        // FK to champions.id. For now JSONB is sufficient and flexible.
        //
        // JSONB slots shape:
        //   [
        //     {x: 0, y: 0, champion_api_name: "TFT17_Aatrox", star_level: 2, items: [...], augment?: "..."},
        //     ...
        //   ]
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->string('name', 150);
            $table->text('notes')->nullable();
            $table->jsonb('slots')->default('[]');

            // Public sharing: opt-in, share via random token URL.
            $table->boolean('is_public')->default(false);
            $table->string('share_token', 32)->nullable()->unique();

            $table->timestampsTz();

            $table->index(['user_id', 'updated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('plans');
    }
};
