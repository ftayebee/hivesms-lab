<?php

namespace App\Models;

use App\Enums\ConsentStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/** Table `contacts`. */
class Contact extends BaseModel
{
    use HasFactory;
    use HasUuids;
    use SoftDeletes;

    protected $table = 'contacts';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    const DELETED_AT = 'deletedAt';

    protected $fillable = [
        'organizationId',
        'name',
        'phone',
        'email',
        'company',
        'tags',
        'customFields',
        'consentStatus',
        'consentSource',
        'consentAt',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'tags' => '[]',
        'customFields' => '{}',
        'consentStatus' => 'UNKNOWN',
    ];

    protected function casts(): array
    {
        return [
            'tags' => 'array',
            'customFields' => 'array',
            'consentStatus' => ConsentStatus::class,
            'consentAt' => 'datetime',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
            'deletedAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function groups(): HasMany
    {
        return $this->hasMany(ContactGroupMember::class, 'contactId');
    }

    public function contactGroups(): BelongsToMany
    {
        return $this->belongsToMany(ContactGroup::class, 'contact_group_members', 'contactId', 'groupId')->using(ContactGroupMember::class)->withPivot('addedAt');
    }
}
