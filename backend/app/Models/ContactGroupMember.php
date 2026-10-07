<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\Pivot;

/** Pivot: contact membership of a group (composite key groupId + contactId). */
class ContactGroupMember extends Pivot
{
    use HasFactory;

    protected $table = 'contact_group_members';

    /** Composite primary key: not addressable through Eloquent's find(); query by columns. */
    protected $primaryKey = null;

    public $incrementing = false;

    protected $dateFormat = 'Y-m-d H:i:s.v';

    public $timestamps = false;

    protected $fillable = [
        'groupId',
        'contactId',
        'addedAt',
    ];

    protected function casts(): array
    {
        return [
            'addedAt' => 'datetime',
        ];
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(ContactGroup::class, 'groupId');
    }

    public function contact(): BelongsTo
    {
        return $this->belongsTo(Contact::class, 'contactId');
    }
}
