<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('champions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->string('api_name', 100);
            $table->string('name', 100);
            $table->smallInteger('cost');
            // slots_used = 1 for all champions except Mecha Enhanced (= 2).
            // Set in post-import hook MechaEnhancedHook, not from CDragon.
            $table->smallInteger('slots_used')->default(1);

            // Role: "ADFighter" stored as-is for backward compat,
            // plus derived damage_type and role_category for 2-axis filtering.
            $table->string('role', 30)->nullable();
            $table->char('damage_type', 2)->nullable();
            $table->string('role_category', 20)->nullable();

            // Decision #3a: base Miss Fortune exists in table but is_playable = false
            // so frontend planner lists won't show it (only her 3 variants).
            // Mecha base champions and enhanced variants are all is_playable = true.
            $table->boolean('is_playable')->default(true);

            // Stats (query-able columns, Postgres float = double precision is fine)
            $table->float('hp')->default(0);
            $table->float('armor')->default(0);
            $table->float('magic_resist')->default(0);
            $table->float('attack_damage')->default(0);
            $table->float('attack_speed')->default(0);
            $table->float('mana')->default(0);
            $table->float('start_mana')->default(0);
            $table->float('range')->default(0);
            $table->float('crit_chance')->default(0.25);
            $table->float('crit_multiplier')->default(1.4);

            // Ability — raw HTML/template text + structured stats per star level
            $table->text('ability_desc')->nullable();
            $table->jsonb('ability_stats')->default('[]');

            // Variant relations (self-FK replacing exclusion_groups table)
            $table->unsignedBigInteger('base_champion_id')->nullable();
            $table->string('variant_label', 50)->nullable();

            // External references
            $table->integer('planner_code')->nullable();
            $table->string('icon_path', 500)->nullable();

            $table->timestampsTz();

            $table->unique(['set_id', 'api_name']);
            $table->index('cost');
            $table->index('base_champion_id');
            $table->index('is_playable');

            // Self-FK added after all columns defined — safe in Postgres
            $table->foreign('base_champion_id')
                ->references('id')
                ->on('champions')
                ->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('champions');
    }
};
