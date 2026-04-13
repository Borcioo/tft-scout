<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('champions', function (Blueprint $table) {
            $table->string('ability_name', 150)->nullable()->after('ability_desc');
            $table->string('ability_icon_path', 500)->nullable()->after('ability_name');
        });
    }

    public function down(): void
    {
        Schema::table('champions', function (Blueprint $table) {
            $table->dropColumn(['ability_name', 'ability_icon_path']);
        });
    }
};
