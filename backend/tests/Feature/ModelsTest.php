<?php

namespace Tests\Feature;

use App\Enums\ConsentStatus;
use App\Enums\PlatformRole;
use App\Models\BaseModel;
use App\Models\Contact;
use App\Models\ContactGroup;
use App\Models\Counter;
use App\Models\Organization;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use App\Models\Wallet;
use Illuminate\Database\Eloquent\MassAssignmentException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasOneOrMany;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Schema;
use ReflectionClass;
use ReflectionMethod;
use ReflectionNamedType;
use Tests\TestCase;

class ModelsTest extends TestCase
{
    use RefreshDatabase;

    /** @return list<class-string<Model>> */
    private function models(): array
    {
        $classes = [];
        foreach (glob(app_path('Models/*.php')) as $file) {
            $class = 'App\\Models\\'.basename($file, '.php');
            if ($class !== BaseModel::class) {
                $classes[] = $class;
            }
        }

        return $classes;
    }

    /** @return list<string> */
    private function columns(string $table): array
    {
        return Schema::getColumnListing($table);
    }

    public function test_there_is_one_model_per_application_table(): void
    {
        $tables = collect($this->models())->map(fn (string $c) => (new $c)->getTable())->sort()->values()->all();
        $this->assertCount(42, $tables);
        $this->assertSame($tables, array_values(array_unique($tables)));
    }

    public function test_every_model_column_reference_exists_in_the_database(): void
    {
        foreach ($this->models() as $class) {
            /** @var Model $model */
            $model = new $class;
            $columns = $this->columns($model->getTable());
            $this->assertNotEmpty($columns, "table {$model->getTable()} missing");

            $referenced = array_merge($model->getFillable(), $model->getHidden(), array_keys($model->getCasts()), array_keys($model->getAttributes()));
            if ($model->usesTimestamps()) {
                $referenced = array_merge($referenced, array_filter([$model->getCreatedAtColumn(), $model->getUpdatedAtColumn()]));
            }
            if (method_exists($model, 'getDeletedAtColumn')) {
                $referenced[] = $model->getDeletedAtColumn();
            }
            if ($model->getKeyName() !== null) {
                $referenced[] = $model->getKeyName();
            }
            foreach (array_unique($referenced) as $column) {
                $this->assertContains($column, $columns, "{$class} references missing column {$model->getTable()}.{$column}");
            }
        }
    }

    public function test_every_relation_uses_existing_key_columns(): void
    {
        $checked = 0;
        foreach ($this->models() as $class) {
            foreach ((new ReflectionClass($class))->getMethods(ReflectionMethod::IS_PUBLIC) as $method) {
                $type = $method->getReturnType();
                if ($method->class !== $class || ! $type instanceof ReflectionNamedType || ! is_subclass_of($type->getName(), Relation::class)) {
                    continue;
                }
                $relation = (new $class)->{$method->name}();
                $label = "{$class}::{$method->name}()";
                $parentTable = $relation->getParent()->getTable();
                $relatedTable = $relation->getRelated()->getTable();

                if ($relation instanceof BelongsTo) {
                    $this->assertContains($relation->getForeignKeyName(), $this->columns($parentTable), $label);
                    $this->assertContains($relation->getOwnerKeyName(), $this->columns($relatedTable), $label);
                } elseif ($relation instanceof BelongsToMany) {
                    $pivot = $this->columns($relation->getTable());
                    $this->assertContains($relation->getForeignPivotKeyName(), $pivot, $label);
                    $this->assertContains($relation->getRelatedPivotKeyName(), $pivot, $label);
                } elseif ($relation instanceof HasOneOrMany) {
                    $this->assertContains($relation->getForeignKeyName(), $this->columns($relatedTable), $label);
                } else {
                    $this->fail("{$label}: unexpected relation type ".get_class($relation));
                }
                $checked++;
            }
        }
        $this->assertGreaterThan(90, $checked);
    }

    public function test_round_trip_keeps_the_existing_column_conventions(): void
    {
        $org = Organization::factory()->create();
        $wallet = Wallet::factory()->for($org)->create();
        $user = User::factory()->create();
        $contact = Contact::factory()->for($org)->create(['tags' => ['vip']]);

        $wallet->refresh();
        $contact->refresh();
        $user->refresh();

        $this->assertMatchesRegularExpression('/^[0-9a-f-]{36}$/', $org->id);
        $this->assertSame('0.0000', $wallet->balance);
        $this->assertSame('100.0000', $wallet->lowBalanceThreshold);
        $this->assertSame(['vip'], $contact->tags);
        $this->assertSame(ConsentStatus::UNKNOWN, $contact->consentStatus);
        $this->assertSame(PlatformRole::USER, $user->platformRole);
        $this->assertSame($org->id, $wallet->organization->id);
        $this->assertSame($wallet->id, $org->wallet->id);

        $json = $user->toArray();
        $this->assertArrayNotHasKey('passwordHash', $json);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/', $json['createdAt']);
    }

    public function test_timestamps_keep_millisecond_precision(): void
    {
        $user = User::factory()->create();
        $user->forceFill(['lastLoginAt' => Carbon::parse('2026-10-07 09:15:00.123', 'UTC')])->save();

        $this->assertSame('09:15:00.123', $user->fresh()->lastLoginAt->format('H:i:s.v'));
    }

    public function test_existing_argon2id_hashes_from_the_node_app_verify_in_php(): void
    {
        // Produced by @node-rs/argon2 hash("Demo#Flow2026", { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 }).
        $nodeHash = '$argon2id$v=19$m=19456,t=2,p=1$jfLSejP2FTPMke8R7dQ/Pw$C2m6j6ESUhy3tU01iPTPd6VZWsD56yqGJ8lqxiMUiWc';
        $this->assertTrue(password_verify('Demo#Flow2026', $nodeHash));
        $this->assertFalse(password_verify('wrong', $nodeHash));
    }

    public function test_soft_deleted_rows_are_hidden_by_default(): void
    {
        $contact = Contact::factory()->create();
        $contact->delete();

        $this->assertNotNull($contact->fresh()?->deletedAt ?? Contact::withTrashed()->find($contact->id)->deletedAt);
        $this->assertSame(0, Contact::count());
        $this->assertSame(1, Contact::withTrashed()->count());
    }

    public function test_wallet_balance_cannot_go_negative_even_bypassing_the_application(): void
    {
        $wallet = Wallet::factory()->create();

        $this->expectException(QueryException::class);
        $wallet->forceFill(['balance' => '-0.0001'])->save();
    }

    public function test_privileged_columns_cannot_be_mass_assigned(): void
    {
        $this->expectException(MassAssignmentException::class);
        new User(['email' => 'a@example.com', 'platformRole' => 'SUPER_ADMIN']);
    }

    public function test_many_to_many_helpers_use_the_existing_pivot_tables(): void
    {
        $org = Organization::factory()->create();
        $role = Role::create(['organizationId' => $org->id, 'key' => 'OWNER', 'name' => 'Owner']);
        $permission = Permission::create(['key' => 'contacts:read', 'group' => 'Contacts', 'description' => 'View contacts']);
        $role->grantedPermissions()->attach($permission->id);

        $group = ContactGroup::factory()->for($org)->create();
        $contact = Contact::factory()->for($org)->create();
        $group->contacts()->attach($contact->id);

        $this->assertSame(['contacts:read'], $role->grantedPermissions()->pluck('key')->all());
        $this->assertSame(1, $role->permissions()->count());
        $this->assertNotNull($contact->contactGroups()->first()->pivot->addedAt);
    }

    public function test_string_key_models(): void
    {
        $this->assertSame(1000, Counter::query()->findOrFail('invoice_number')->value);
    }
}
