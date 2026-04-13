<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Symmetric "how often is champion X played WITH champion Y" data.
        // Both FKs point to champions.id — CHECK prevents self-pairing.
        // Asymmetric storage: (A, B) and (B, A) are both inserted so lookups
        // by either direction hit the index (no WHERE (a=X OR b=X) needed).
        Schema::create('champion_companions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('champion_id')->constrained()->cascadeOnDelete();
            $table->foreignId('companion_champion_id')->constrained('champions')->cascadeOnDelete();
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->float('avg_place');
            $table->integer('games');
            $table->float('frequency');
            $table->timestampTz('updated_at')->useCurrent();

            $table->unique(['champion_id', 'companion_champion_id'], 'champion_companion_pair');
            $table->index('champion_id');
            $table->index('companion_champion_id');
        });

        // Laravel Schema Builder has no native CHECK constraint API — use raw DDL.
        // Prevents inserting "Aatrox is a companion of Aatrox" nonsense at DB level.
        DB::statement('
            ALTER TABLE champion_companions
            ADD CONSTRAINT champion_companions_no_self_pair
            CHECK (champion_id != companion_champion_id)
        ');
    }

    public function down(): void
    {
        Schema::dropIfExists('champion_companions');
    }
};
