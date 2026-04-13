<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sets', function (Blueprint $table) {
            $table->id();
            $table->smallInteger('number')->unique();
            $table->string('name', 100);
            $table->string('mutator', 50)->nullable();
            $table->boolean('is_active')->default(false);
            $table->date('released_at')->nullable();
            $table->date('retired_at')->nullable();
            $table->timestampTz('imported_at')->nullable();
            $table->string('cdragon_version', 50)->nullable();
            $table->timestampsTz();

            $table->index('is_active');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sets');
    }
};
