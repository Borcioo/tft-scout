<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * MetaTFT cluster ids are only unique within one set's data, and the
     * sync rebuilds meta comps per set. A global unique broke the first
     * Set 18 sync in production: Set 17 had been synced from the PBE
     * queue, which already carried Set 18 clusters (key 426000).
     */
    public function up(): void
    {
        Schema::table('meta_comps', function (Blueprint $table) {
            $table->dropUnique(['cluster_id']);
            $table->dropUnique(['external_id']);
            $table->unique(['set_id', 'cluster_id']);
            $table->unique(['set_id', 'external_id']);
        });
    }

    /**
     * Fails if two sets already share a cluster id — that data is what
     * this migration exists to allow.
     */
    public function down(): void
    {
        Schema::table('meta_comps', function (Blueprint $table) {
            $table->dropUnique(['set_id', 'cluster_id']);
            $table->dropUnique(['set_id', 'external_id']);
            $table->unique('cluster_id');
            $table->unique('external_id');
        });
    }
};
