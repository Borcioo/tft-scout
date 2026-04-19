<?php

namespace Tests\Feature\Controllers;

use App\Http\Middleware\RevalidateMetaTft;
use App\Services\Scout\ScoutContextBuilder;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class RandomControllerTest extends TestCase
{
    public function test_random_page_renders_with_expected_props(): void
    {
        // The page component (`resources/js/pages/Random/Index.tsx`) is
        // wired up in the follow-up frontend task — disable the Inertia
        // file-exists check so this backend-only test passes today and
        // still protects the controller's props contract.
        config()->set('inertia.testing.ensure_pages_exist', false);

        // The controller delegates DB-touching work to ScoutContextBuilder.
        // Bind a fake so the test exercises the route/controller contract
        // (Inertia component + prop shape) without needing a seeded Set.
        $this->instance(ScoutContextBuilder::class, new class extends ScoutContextBuilder
        {
            public function __construct() {}

            public function buildItemBuildsForInertia(int $setNumber): array
            {
                return [];
            }
        });

        $response = $this
            ->withoutMiddleware(RevalidateMetaTft::class)
            ->get('/random');

        $response->assertOk();
        $response->assertInertia(fn (Assert $page) => $page
            ->component('Random/Index')
            ->has('setNumber')
            ->has('itemBuilds')
            ->has('savedPlannerCodes')
        );
    }
}
