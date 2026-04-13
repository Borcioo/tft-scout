<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('items', function (Blueprint $table) {
            $table->unsignedBigInteger('radiant_parent_id')->nullable()->after('component_2_id');
            $table->index('radiant_parent_id');
            $table->foreign('radiant_parent_id')
                ->references('id')
                ->on('items')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('items', function (Blueprint $table) {
            $table->dropForeign(['radiant_parent_id']);
            $table->dropColumn('radiant_parent_id');
        });
    }
};
