<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * How many units of the trait the champion contributes. 1 for almost
     * everyone; Set 18 Lux variants count their element twice and Elder
     * Dragon gives 2 Riftbeast (both straight from the character bin's
     * `mLinkedTraits[].Amount`), Set 17 Mecha Enhanced forms count 2 Mecha.
     */
    public function up(): void
    {
        Schema::table('champion_trait', function (Blueprint $table) {
            $table->smallInteger('amount')->default(1);
        });
    }

    public function down(): void
    {
        Schema::table('champion_trait', function (Blueprint $table) {
            $table->dropColumn('amount');
        });
    }
};
