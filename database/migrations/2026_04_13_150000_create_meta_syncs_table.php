<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('meta_syncs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->timestampTz('synced_at')->useCurrent();
            $table->integer('units_count')->default(0);
            $table->integer('traits_count')->default(0);
            $table->integer('affinity_count')->default(0);
            $table->integer('companions_count')->default(0);
            $table->integer('meta_comps_count')->default(0);
            $table->string('status', 20)->default('ok'); // ok | partial | failed
            $table->text('notes')->nullable();

            $table->index(['set_id', 'synced_at']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('meta_syncs');
    }
};
