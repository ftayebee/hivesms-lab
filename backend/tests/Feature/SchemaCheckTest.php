<?php

namespace Tests\Feature;

use App\Services\Platform\SchemaInspector;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** The deployment schema check must agree with the baseline migration and detect drift. */
class SchemaCheckTest extends TestCase
{
    use RefreshDatabase;

    public function test_baseline_database_matches_the_expected_schema_file(): void
    {
        $this->artisan('app:schema-check')->expectsOutputToContain('matches the expected baseline exactly')->assertExitCode(0);
    }

    public function test_diff_reports_added_removed_and_changed_definitions(): void
    {
        $expected = app(SchemaInspector::class)->expected();
        $actual = $expected;
        $actual['tables']['contacts']['columns']['extra'] = 'int NULL';
        unset($actual['tables']['contacts']['indexes']['contacts_organizationId_phone_key']);
        $actual['tables']['users']['columns']['email'] = 'varchar(10) NULL';
        unset($actual['tables']['templates']);

        $diff = SchemaInspector::diff($expected, $actual);
        $this->assertContains('- table templates', $diff);
        $this->assertContains('+ contacts.columns.extra: int NULL', $diff);
        $this->assertContains('- contacts.indexes.contacts_organizationId_phone_key: UNIQUE(organizationId,phone)', $diff);
        $this->assertCount(1, array_filter($diff, fn ($l) => str_starts_with($l, '~ users.columns.email')));
        $this->assertSame([], SchemaInspector::diff($expected, $expected));
    }

    public function test_expected_schema_cannot_be_rewritten_from_production(): void
    {
        $this->app['env'] = 'production';
        $this->artisan('app:schema-check --write-expected')->assertExitCode(1);
    }
}
