<?php

use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| Pest runs the existing PHPUnit test classes as they are; closure-style
| tests in these folders get Laravel's TestCase bound as `$this`.
|
*/

pest()->extend(TestCase::class)->in('Feature', 'Unit');
