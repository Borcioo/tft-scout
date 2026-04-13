<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('emblems', function (Blueprint $table) {
            $table->text('description')->nullable()->after('name');
            $table->jsonb('effects')->default('{}')->after('description');
            $table->unsignedBigInteger('component_1_id')->nullable()->after('effects');
            $table->unsignedBigInteger('component_2_id')->nullable()->after('component_1_id');

            $table->foreign('component_1_id')->references('id')->on('items')->nullOnDelete();
            $table->foreign('component_2_id')->references('id')->on('items')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('emblems', function (Blueprint $table) {
            $table->dropForeign(['component_1_id']);
            $table->dropForeign(['component_2_id']);
            $table->dropColumn(['description', 'effects', 'component_1_id', 'component_2_id']);
        });
    }
};
