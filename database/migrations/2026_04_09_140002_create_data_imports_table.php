<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Audit trail for data imports (CDragon, MetaTFT).
        // Solves Problem #12 from schema-plan: before this table, there was
        // no way to know WHEN an import ran, WHAT version of CDragon, or
        // HOW MANY records changed. Useful for debugging "why does this
        // champion have weird stats" questions.
        //
        // Populated by CDragonImporter (and future MetaTftImporter) at the
        // start and end of each run — both success and failure cases.
        Schema::create('data_imports', function (Blueprint $table) {
            $table->id();
            $table->string('source', 30); // "cdragon" | "metatft"
            $table->string('endpoint', 50)->nullable(); // for metatft sub-endpoints
            $table->foreignId('set_id')->nullable()->constrained()->nullOnDelete();
            $table->timestampTz('started_at');
            $table->timestampTz('completed_at')->nullable();
            $table->string('status', 20); // "running" | "success" | "failed"
            $table->integer('records_affected')->default(0);
            $table->text('error_message')->nullable();
            $table->jsonb('metadata')->default('{}');
            // ^ flexible: counts per table, cdragon version, params, etc.

            $table->index(['source', 'started_at']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('data_imports');
    }
};
