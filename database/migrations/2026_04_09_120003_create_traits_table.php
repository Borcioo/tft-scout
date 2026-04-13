<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('traits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->string('api_name', 100);
            $table->string('name', 100);
            $table->text('description')->nullable();
            $table->string('icon_path', 500)->nullable();
            // Category distinguishes 3 trait kinds found in Set 17 data:
            //   - "public"  → visible main traits (Mecha, Astronaut, DarkStar)
            //   - "unique"  → per-champion unique traits (ShenUniqueTrait)
            //   - "hidden"  → MetaTFT grouping categories (HPTank, ResistTank, FlexTrait)
            $table->string('category', 20);
            $table->boolean('is_unique')->default(false);
            $table->timestampsTz();

            $table->unique(['set_id', 'api_name']);
            $table->index('category');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('traits');
    }
};
