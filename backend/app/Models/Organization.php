<?php

namespace App\Models;

use App\Enums\OrganizationStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/** Tenant. Every customer-owned row carries organizationId. */
class Organization extends BaseModel
{
    use HasFactory;
    use HasUuids;
    use SoftDeletes;

    protected $table = 'organizations';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    const DELETED_AT = 'deletedAt';

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'name',
        'slug',
        'industry',
        'website',
        'address',
        'billingEmail',
        'taxId',
        'country',
        'timezone',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'status' => 'ACTIVE',
        'country' => 'BD',
        'timezone' => 'Asia/Dhaka',
        'dailySendLimit' => 1000,
        'monthlySendLimit' => 20000,
        'requireCampaignReview' => true,
    ];

    protected function casts(): array
    {
        return [
            'status' => OrganizationStatus::class,
            'dailySendLimit' => 'integer',
            'monthlySendLimit' => 'integer',
            'requireCampaignReview' => 'boolean',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
            'deletedAt' => 'datetime',
        ];
    }

    public function pricingPlan(): BelongsTo
    {
        return $this->belongsTo(PricingPlan::class, 'pricingPlanId');
    }

    public function members(): HasMany
    {
        return $this->hasMany(OrganizationMember::class, 'organizationId');
    }

    public function roles(): HasMany
    {
        return $this->hasMany(Role::class, 'organizationId');
    }

    public function invitations(): HasMany
    {
        return $this->hasMany(Invitation::class, 'organizationId');
    }

    public function contacts(): HasMany
    {
        return $this->hasMany(Contact::class, 'organizationId');
    }

    public function contactGroups(): HasMany
    {
        return $this->hasMany(ContactGroup::class, 'organizationId');
    }

    public function suppressionEntries(): HasMany
    {
        return $this->hasMany(SuppressionEntry::class, 'organizationId');
    }

    public function campaigns(): HasMany
    {
        return $this->hasMany(Campaign::class, 'organizationId');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class, 'organizationId');
    }

    public function templates(): HasMany
    {
        return $this->hasMany(Template::class, 'organizationId');
    }

    public function senderIds(): HasMany
    {
        return $this->hasMany(SenderId::class, 'organizationId');
    }

    public function apiKeys(): HasMany
    {
        return $this->hasMany(ApiKey::class, 'organizationId');
    }

    public function apiLogs(): HasMany
    {
        return $this->hasMany(ApiLog::class, 'organizationId');
    }

    public function idempotencyKeys(): HasMany
    {
        return $this->hasMany(IdempotencyKey::class, 'organizationId');
    }

    public function wallet(): HasOne
    {
        return $this->hasOne(Wallet::class, 'organizationId');
    }

    public function walletTransactions(): HasMany
    {
        return $this->hasMany(WalletTransaction::class, 'organizationId');
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class, 'organizationId');
    }

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class, 'organizationId');
    }

    public function supportTickets(): HasMany
    {
        return $this->hasMany(SupportTicket::class, 'organizationId');
    }

    public function webhooks(): HasMany
    {
        return $this->hasMany(WebhookEndpoint::class, 'organizationId');
    }

    public function auditLogs(): HasMany
    {
        return $this->hasMany(AuditLog::class, 'organizationId');
    }

    public function notifications(): HasMany
    {
        return $this->hasMany(Notification::class, 'organizationId');
    }
}
