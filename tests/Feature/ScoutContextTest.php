<?php

namespace Tests\Feature;

use Tests\TestCase;

class ScoutContextTest extends TestCase
{
    public function test_context_endpoint_returns_top_level_shape(): void
    {
        $response = $this->getJson('/api/scout/context');

        $response->assertOk();
        $response->assertJsonStructure([
            'champions',
            'traits',
            'exclusionGroups',
            'scoringCtx' => [
                'unitRatings',
                'traitRatings',
                'affinity',
                'companions',
                'metaComps',
                'styleScores',
            ],
            'syncedAt',
            'stale',
        ]);
    }

    public function test_champions_include_required_fields(): void
    {
        $response = $this->getJson('/api/scout/context');
        $champion = $response->json('champions.0');

        $this->assertIsArray($champion);
        $this->assertArrayHasKey('apiName', $champion);
        $this->assertArrayHasKey('cost', $champion);
        $this->assertArrayHasKey('traits', $champion);
        $this->assertArrayHasKey('slotsUsed', $champion);
    }

    public function test_traits_include_breakpoints(): void
    {
        $response = $this->getJson('/api/scout/context');
        $trait = $response->json('traits.0');

        $this->assertIsArray($trait);
        $this->assertArrayHasKey('breakpoints', $trait);
        $this->assertIsArray($trait['breakpoints']);
    }
}
