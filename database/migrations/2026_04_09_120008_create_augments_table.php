<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Decision #2 → A: augments table created in MVP, import filtered to
        // current set only (TFT17_Augment_*), excluding 2954 historical cruft
        // rows that polluted the old items table.
        Schema::create('augments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->string('api_name', 100)->unique();
            $table->string('name', 100);
            $table->text('description')->nullable();
            // tier: silver | gold | prismatic | hero
            $table->string('tier', 20);
            $table->jsonb('effects')->default('{}');
            // Trait-gated augments (e.g. "Determined Mechaticians" requires Mecha)
            // point to their required trait. Most augments have no trait gate.
            $table->foreignId('associated_trait_id')
                ->nullable()
                ->constrained('traits')
                ->nullOnDelete();
            $table->string('icon_path', 500)->nullable();
            $table->timestampsTz();

            $table->index('tier');
            $table->index('associated_trait_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('augments');
    }
};
