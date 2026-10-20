<?php

namespace Tests\Unit\Support;

use App\Support\SetProfile;
use Tests\TestCase;

class SetProfileTest extends TestCase
{
    public function test_unconfigured_set_falls_back_to_tft_prefix_and_evergreen_items(): void
    {
        $profile = SetProfile::for(42);

        $this->assertSame(['TFT42_'], $profile->prefixes);
        $this->assertTrue($profile->evergreenItems);
        $this->assertTrue($profile->owns('TFT42_Jinx'));
        $this->assertFalse($profile->owns('TFT17_Jinx'));
    }

    public function test_set_18_owns_namespaced_ids(): void
    {
        $profile = SetProfile::for(18);

        $this->assertFalse($profile->evergreenItems);
        $this->assertTrue($profile->owns('DA_18_Ahri'));
        $this->assertTrue($profile->owns('DA_Amumu18'));
        $this->assertTrue($profile->owns('DA_InfinityEdge'));
        $this->assertFalse($profile->owns('TFT_Item_InfinityEdge'));
        $this->assertFalse($profile->owns('TFT9_SLIME_Crab'));
        $this->assertSame(['DA_18_ApexPredator' => 2], $profile->slotsByTrait);
    }

    public function test_canonical_unit_folds_adaptor_forms(): void
    {
        $profile = SetProfile::for(18);
        $known = [
            'DA_18_MasterYi_AD' => true,
            'DA_Gromp18_AP' => true,
            'DA_Nidalee18_AP' => true,
            'DA_18_Ahri' => true,
        ];

        // `_AD`/`_AP` sibling of a known champion
        $this->assertSame('DA_18_MasterYi_AD', $profile->canonicalUnit('DA_18_MasterYi_AP', $known));
        $this->assertSame('DA_Gromp18_AP', $profile->canonicalUnit('DA_Gromp18_AD', $known));
        // explicit alias for forms whose id differs beyond the suffix
        $this->assertSame('DA_Nidalee18_AP', $profile->canonicalUnit('DA_NidaleeCougar18_AD', $known));
        // known ids and unknown ids pass through
        $this->assertSame('DA_18_Ahri', $profile->canonicalUnit('DA_18_Ahri', $known));
        $this->assertSame('TFT18_SprykinSummonMelee', $profile->canonicalUnit('TFT18_SprykinSummonMelee', $known));
    }
}
