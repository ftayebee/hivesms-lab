<?php

namespace App\Services\Contact;

use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Models\Contact;
use App\Models\ContactGroup;
use App\Models\ContactGroupMember;
use App\Models\SuppressionEntry;
use App\Services\Platform\AuditLogger;
use App\Support\Csv;
use App\Support\ErrorCode;
use App\Support\Phone;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Contacts, groups and the suppression list (port of features/contacts/service.ts). Every query is
 * scoped to the tenant and every lookup by id uses (id, organizationId): other tenants' ids behave
 * exactly like ids that do not exist (404), so nothing leaks.
 */
class ContactService
{
    public const PAGE_SIZE = 25;

    public function __construct(private readonly AuditLogger $audit) {}

    /** @param array{q?: ?string, group?: ?string, tag?: ?string, consent?: ?string} $f */
    private function listQuery(TenantContext $ctx, array $f): Builder
    {
        $q = Contact::query()->where('organizationId', $ctx->organizationId);
        if (! empty($f['q'])) {
            $term = $f['q'];
            $phone = Phone::normalize($term) ?? (preg_replace('/[^\d+]/', '', $term) ?: $term);
            // Text columns use utf8mb4_unicode_ci, so LIKE is case-insensitive.
            $q->where(fn ($w) => $w->where('name', 'like', '%'.self::like($term).'%')
                ->orWhere('email', 'like', '%'.self::like($term).'%')
                ->orWhere('company', 'like', '%'.self::like($term).'%')
                ->orWhere('phone', 'like', '%'.self::like($phone).'%'));
        }
        if (! empty($f['group'])) {
            $q->whereHas('groups', fn ($g) => $g->where('groupId', $f['group']));
        }
        if (! empty($f['tag'])) {
            $q->whereJsonContains('tags', $f['tag']);
        }
        if (! empty($f['consent'])) {
            $q->where('consentStatus', $f['consent']);
        }

        return $q;
    }

    public static function like(string $v): string
    {
        return addcslashes($v, '%_\\');
    }

    /** @param array{q?: ?string, group?: ?string, tag?: ?string, consent?: ?string, sort?: ?string, page?: int} $f */
    public function list(TenantContext $ctx, array $f): LengthAwarePaginator
    {
        $ctx->requirePermission('contacts:read');
        $q = $this->listQuery($ctx, $f)->with(['contactGroups' => fn ($g) => $g->select(['contact_groups.id', 'contact_groups.name'])]);
        match ($f['sort'] ?? 'newest') {
            'oldest' => $q->orderBy('createdAt'),
            'name' => $q->orderBy('name'),
            default => $q->orderByDesc('createdAt'),
        };

        return $q->paginate(self::PAGE_SIZE, ['*'], 'page', $f['page'] ?? 1);
    }

    public function find(TenantContext $ctx, string $id): Contact
    {
        $ctx->requirePermission('contacts:read');

        return Contact::query()->with(['contactGroups' => fn ($g) => $g->select(['contact_groups.id', 'contact_groups.name'])])
            ->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Contact not found.');
    }

    /** @param list<string> $groupIds */
    public function assertGroupsOwned(TenantContext $ctx, array $groupIds): void
    {
        $groupIds = array_values(array_unique($groupIds));
        if (! $groupIds) {
            return;
        }
        $n = ContactGroup::query()->where('organizationId', $ctx->organizationId)->whereIn('id', $groupIds)->count();
        if ($n !== count($groupIds)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'One or more groups were not found.', ['field' => 'groupIds']);
        }
    }

    private function syncSuppression(TenantContext $ctx, string $phone, string $consent, string $source): void
    {
        if ($consent === 'OPTED_OUT') {
            DB::table('suppression_entries')->insertOrIgnore([
                'id' => (string) Str::uuid(), 'organizationId' => $ctx->organizationId, 'phone' => $phone,
                'reason' => 'OPT_OUT', 'source' => $source, 'createdAt' => now()->format('Y-m-d H:i:s.v'),
            ]);
        }
    }

    /** @param list<string> $groupIds */
    private function setGroups(string $contactId, array $groupIds): void
    {
        ContactGroupMember::query()->where('contactId', $contactId)->delete();
        if ($groupIds) {
            $now = now()->format('Y-m-d H:i:s.v');
            DB::table('contact_group_members')->insertOrIgnore(array_map(fn ($g) => ['groupId' => $g, 'contactId' => $contactId, 'addedAt' => $now], array_values(array_unique($groupIds))));
        }
    }

    /** @param array{name: ?string, phone: string, email: ?string, company: ?string, tags: list<string>, groupIds: list<string>, consentStatus: string, consentSource: ?string, customFields: array<string, string>} $input */
    public function create(TenantContext $ctx, array $input): Contact
    {
        $ctx->requirePermission('contacts:write');
        $this->assertGroupsOwned($ctx, $input['groupIds']);
        $existing = Contact::withTrashed()->where('organizationId', $ctx->organizationId)->where('phone', $input['phone'])->first();
        if ($existing && ! $existing->trashed()) {
            throw new AppException(ErrorCode::CONFLICT, 'A contact with this number already exists.', ['field' => 'phone']);
        }
        $data = [
            'name' => $input['name'], 'email' => $input['email'], 'company' => $input['company'], 'tags' => $input['tags'],
            'customFields' => (object) $input['customFields'], 'consentStatus' => $input['consentStatus'], 'consentSource' => $input['consentSource'],
            'consentAt' => $input['consentStatus'] !== 'UNKNOWN' ? now() : null,
        ];
        $contact = DB::transaction(function () use ($ctx, $input, $existing, $data) {
            // Re-adding a previously deleted number restores the record instead of violating uniqueness.
            if ($existing) {
                $existing->forceFill($data + ['deletedAt' => null, 'createdAt' => now()])->save();
                $c = $existing;
            } else {
                $c = Contact::query()->forceCreate($data + ['organizationId' => $ctx->organizationId, 'phone' => $input['phone']]);
            }
            $this->setGroups($c->id, $input['groupIds']);

            return $c;
        });
        $this->syncSuppression($ctx, $contact->phone, $input['consentStatus'], 'contact form');
        $this->audit->log('contact.create', $ctx->actor(), $ctx->organizationId, 'contact', $contact->id);

        return $this->find($ctx, $contact->id);
    }

    /** @param array{name: ?string, phone: string, email: ?string, company: ?string, tags: list<string>, groupIds: list<string>, consentStatus: string, consentSource: ?string, customFields: array<string, string>} $input */
    public function update(TenantContext $ctx, string $id, array $input): Contact
    {
        $ctx->requirePermission('contacts:write');
        $current = $this->find($ctx, $id);
        $this->assertGroupsOwned($ctx, $input['groupIds']);
        if ($input['phone'] !== $current->phone) {
            $clash = Contact::withTrashed()->where('organizationId', $ctx->organizationId)->where('phone', $input['phone'])->first();
            if ($clash && ! $clash->trashed()) {
                throw new AppException(ErrorCode::CONFLICT, 'Another contact already uses this number.', ['field' => 'phone']);
            }
            $clash?->forceDelete(); // remove the stale soft-deleted duplicate
        }
        $consentChanged = $input['consentStatus'] !== $current->consentStatus->value;
        DB::transaction(function () use ($current, $input, $consentChanged) {
            $current->forceFill([
                'name' => $input['name'], 'phone' => $input['phone'], 'email' => $input['email'], 'company' => $input['company'],
                'tags' => $input['tags'], 'customFields' => (object) $input['customFields'], 'consentStatus' => $input['consentStatus'],
                'consentSource' => $input['consentSource'],
            ] + ($consentChanged ? ['consentAt' => now()] : []))->save();
            $this->setGroups($current->id, $input['groupIds']);
        });
        if ($consentChanged) {
            $this->syncSuppression($ctx, $input['phone'], $input['consentStatus'], 'contact edit');
        }
        $this->audit->log('contact.update', $ctx->actor(), $ctx->organizationId, 'contact', $id, $consentChanged ? ['consent' => $input['consentStatus']] : []);

        return $this->find($ctx, $id);
    }

    /**
     * Bulk actions on up to 1,000 contacts. Only ids of this organization are touched.
     *
     * @param  list<string>  $ids
     * @param  array{type: string, groupId?: string, tag?: string, consent?: string}  $action
     */
    public function bulk(TenantContext $ctx, array $ids, array $action): int
    {
        $ctx->requirePermission('contacts:write');
        if (! $ids) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Select at least one contact.');
        }
        if (count($ids) > 1000) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Select at most 1,000 contacts at a time.');
        }
        $owned = Contact::query()->where('organizationId', $ctx->organizationId)->whereIn('id', $ids)->get(['id', 'phone']);
        $ownedIds = $owned->pluck('id')->all();
        if (! $ownedIds) {
            return 0;
        }
        $now = now()->format('Y-m-d H:i:s.v');
        switch ($action['type']) {
            case 'delete':
                DB::transaction(function () use ($ownedIds, $now) {
                    Contact::query()->whereIn('id', $ownedIds)->update(['deletedAt' => $now]);
                    ContactGroupMember::query()->whereIn('contactId', $ownedIds)->delete();
                });
                break;
            case 'addToGroup':
                $this->assertGroupsOwned($ctx, [$action['groupId']]);
                DB::table('contact_group_members')->insertOrIgnore(array_map(fn ($c) => ['groupId' => $action['groupId'], 'contactId' => $c, 'addedAt' => $now], $ownedIds));
                break;
            case 'removeFromGroup':
                $this->assertGroupsOwned($ctx, [$action['groupId']]);
                ContactGroupMember::query()->where('groupId', $action['groupId'])->whereIn('contactId', $ownedIds)->delete();
                break;
            case 'addTag':
                $tag = mb_substr(preg_replace('/\s+/', '-', mb_strtolower(trim($action['tag'] ?? ''))), 0, 40);
                if ($tag === '') {
                    throw new AppException(ErrorCode::VALIDATION_ERROR, 'Enter a tag.');
                }
                $in = implode(',', array_fill(0, count($ownedIds), '?'));
                DB::update("UPDATE contacts SET tags = JSON_ARRAY_APPEND(tags, '$', ?), updatedAt = ? WHERE id IN ({$in}) AND NOT JSON_CONTAINS(tags, JSON_QUOTE(?))", [$tag, $now, ...$ownedIds, $tag]);
                break;
            case 'setConsent':
                Contact::query()->whereIn('id', $ownedIds)->update(['consentStatus' => $action['consent'], 'consentAt' => $now, 'consentSource' => 'bulk update']);
                if ($action['consent'] === 'OPTED_OUT') {
                    DB::table('suppression_entries')->insertOrIgnore($owned->map(fn ($c) => [
                        'id' => (string) Str::uuid(), 'organizationId' => $ctx->organizationId, 'phone' => $c->phone,
                        'reason' => 'OPT_OUT', 'source' => 'bulk update', 'createdAt' => $now,
                    ])->all());
                }
                break;
            default:
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'Unknown bulk action.');
        }
        $this->audit->log("contact.bulk.{$action['type']}", $ctx->actor(), $ctx->organizationId, metadata: ['count' => count($ownedIds)]);

        return count($ownedIds);
    }

    /** Streams the (filtered) contacts as CSV; never loads the whole list into memory. */
    public function exportCsv(TenantContext $ctx, array $filters, callable $write): void
    {
        $ctx->requirePermission('contacts:export');
        $base = $this->listQuery($ctx, $filters);
        $customKeys = [];
        (clone $base)->select(['id', 'customFields'])->chunkById(2000, function ($rows) use (&$customKeys) {
            foreach ($rows as $r) {
                foreach (array_keys((array) $r->customFields) as $k) {
                    $customKeys[$k] = true;
                }
            }
        });
        $customKeys = array_keys($customKeys);
        sort($customKeys);
        $write(Csv::bom().Csv::line(['phone', 'name', 'email', 'company', 'tags', 'groups', 'consent', 'consent_source', 'created_at', ...$customKeys]));
        $count = 0;
        (clone $base)->with(['contactGroups' => fn ($g) => $g->select(['contact_groups.id', 'contact_groups.name'])])
            ->chunkById(2000, function ($rows) use ($write, $customKeys, &$count) {
                $max = (int) config('smsflow.uploads.csv_max_rows');
                $out = '';
                foreach ($rows as $r) {
                    if ($count >= $max) {
                        break;
                    }
                    $custom = (array) $r->customFields;
                    $out .= Csv::line([
                        $r->phone, $r->name, $r->email, $r->company, implode(',', (array) $r->tags),
                        $r->contactGroups->pluck('name')->implode(','), $r->consentStatus->value, $r->consentSource, $r->createdAt,
                        ...array_map(fn ($k) => $custom[$k] ?? '', $customKeys),
                    ]);
                    $count++;
                }
                $write($out);

                return $count < (int) config('smsflow.uploads.csv_max_rows');
            });
        $this->audit->log('contact.export', $ctx->actor(), $ctx->organizationId, metadata: ['count' => $count]);
    }

    /** Distinct tags (JSON_TABLE is not available on MariaDB < 10.6: collected in PHP). @return list<string> */
    public function tags(TenantContext $ctx): array
    {
        $ctx->requirePermission('contacts:read');
        $tags = [];
        Contact::query()->where('organizationId', $ctx->organizationId)->whereRaw('JSON_LENGTH(tags) > 0')->select(['id', 'tags'])
            ->chunkById(5000, function ($rows) use (&$tags) {
                foreach ($rows as $r) {
                    foreach ((array) $r->tags as $t) {
                        if (is_string($t)) {
                            $tags[$t] = true;
                        }
                    }
                }
            });
        $out = array_keys($tags);
        sort($out);

        return array_slice($out, 0, 200);
    }

    // ─── Groups ───

    /** @return list<array{id: string, name: string, description: ?string, count: int, createdAt: mixed}> */
    public function groups(TenantContext $ctx): array
    {
        $ctx->requirePermission('contacts:read');

        return ContactGroup::query()
            ->where('organizationId', $ctx->organizationId)
            ->withCount(['members as contactsCount' => fn ($m) => $m->whereHas('contact')])
            ->orderBy('name')
            ->get()
            ->map(fn (ContactGroup $g) => ['id' => $g->id, 'name' => $g->name, 'description' => $g->description, 'count' => (int) $g->contactsCount, 'createdAt' => $g->createdAt])
            ->all();
    }

    public function findGroup(TenantContext $ctx, string $id): ContactGroup
    {
        $ctx->requirePermission('contacts:read');

        return ContactGroup::query()->where('organizationId', $ctx->organizationId)->whereKey($id)
            ->withCount(['members as contactsCount' => fn ($m) => $m->whereHas('contact')])->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Group not found.');
    }

    /** @param array{name: string, description: ?string} $input */
    public function saveGroup(TenantContext $ctx, array $input, ?string $id = null): ContactGroup
    {
        $ctx->requirePermission('contacts:write');
        $clash = ContactGroup::withTrashed()->where('organizationId', $ctx->organizationId)->where('name', $input['name'])
            ->when($id, fn ($q) => $q->where('id', '!=', $id))->first();
        if ($clash && ! $clash->trashed()) {
            throw new AppException(ErrorCode::CONFLICT, 'A group with this name already exists.', ['field' => 'name']);
        }
        $clash?->forceDelete();
        if ($id) {
            $g = ContactGroup::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
                ?? throw new AppException(ErrorCode::NOT_FOUND, 'Group not found.');
            $g->forceFill($input)->save();

            return $this->findGroup($ctx, $id);
        }
        $g = ContactGroup::query()->forceCreate($input + ['organizationId' => $ctx->organizationId]);
        $this->audit->log('group.create', $ctx->actor(), $ctx->organizationId, 'group', $g->id);

        return $this->findGroup($ctx, $g->id);
    }

    public function deleteGroup(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('contacts:write');
        $g = ContactGroup::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Group not found.');
        DB::transaction(function () use ($g) {
            ContactGroupMember::query()->where('groupId', $g->id)->delete();
            $g->delete();
        });
        $this->audit->log('group.delete', $ctx->actor(), $ctx->organizationId, 'group', $id);
    }

    // ─── Suppression list ───

    public function suppressionList(TenantContext $ctx, int $page, ?string $q): LengthAwarePaginator
    {
        $ctx->requirePermission('contacts:read');

        return SuppressionEntry::query()
            ->where('organizationId', $ctx->organizationId)
            ->when($q, fn ($w) => $w->where('phone', 'like', '%'.self::like(Phone::normalize($q) ?? preg_replace('/[^\d+]/', '', $q)).'%'))
            ->orderByDesc('createdAt')
            ->paginate(self::PAGE_SIZE, ['*'], 'page', $page);
    }

    /** @param array{phone: string, reason: string, note: ?string} $input */
    public function addSuppression(TenantContext $ctx, array $input): SuppressionEntry
    {
        $ctx->requirePermission('contacts:write');
        $entry = SuppressionEntry::query()->where('organizationId', $ctx->organizationId)->where('phone', $input['phone'])->first();
        if ($entry) {
            $entry->forceFill(['reason' => $input['reason'], 'note' => $input['note']])->save();
        } else {
            $entry = SuppressionEntry::query()->forceCreate([
                'organizationId' => $ctx->organizationId, 'phone' => $input['phone'], 'reason' => $input['reason'], 'note' => $input['note'], 'source' => 'manual',
            ]);
        }
        Contact::query()->where('organizationId', $ctx->organizationId)->where('phone', $input['phone'])
            ->update(['consentStatus' => 'OPTED_OUT', 'consentAt' => now()->format('Y-m-d H:i:s.v'), 'consentSource' => 'suppression list']);
        $this->audit->log('suppression.add', $ctx->actor(), $ctx->organizationId, 'suppression', $entry->id);

        return $entry;
    }

    public function removeSuppression(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('contacts:write');
        $e = SuppressionEntry::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Entry not found.');
        $e->delete();
        $this->audit->log('suppression.remove', $ctx->actor(), $ctx->organizationId, 'suppression', $id, ['reason' => $e->reason->value]);
    }
}
