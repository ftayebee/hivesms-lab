<?php

namespace App\Services\Payment;

use App\Auth\AdminContext;
use App\Exceptions\AppException;
use App\Models\PaymentMethod;
use App\Services\Admin\PrivilegedActionGuard;
use App\Services\Platform\AuditLogger;
use App\Services\SenderId\DocumentStorage;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use App\Support\Money;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * Manual payment receiving accounts (bKash, Nagad, Rocket, bank, other) shown on the customer
 * wallet (docs/22). Only SUPER_ADMIN (admin:settings:manage) changes them, with password
 * re-confirmation: a changed account number redirects customers' money, so a stolen session alone
 * must not be enough. Every change is audited with before/after values.
 */
class PaymentMethodService
{
    private const AUDITED = ['type', 'displayName', 'accountNumber', 'accountName', 'accountType', 'bankName', 'branchName', 'routingNumber',
        'instructions', 'minAmount', 'maxAmount', 'requireProof', 'requireSenderNumber', 'active', 'sortOrder', 'qrImage'];

    public function __construct(
        private readonly DocumentStorage $storage,
        private readonly AuditLogger $audit,
        private readonly PrivilegedActionGuard $guard,
    ) {}

    /** @return Collection<int, PaymentMethod> */
    public function all(): Collection
    {
        return PaymentMethod::query()->orderBy('sortOrder')->orderBy('createdAt')->get();
    }

    /** @return Collection<int, PaymentMethod> active methods, customer-facing order */
    public function active(): Collection
    {
        return PaymentMethod::query()->where('active', true)->orderBy('sortOrder')->orderBy('createdAt')->get();
    }

    public function find(string $id, bool $activeOnly = false): PaymentMethod
    {
        return PaymentMethod::query()->whereKey($id)->when($activeOnly, fn ($q) => $q->where('active', true))->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Payment method not found.');
    }

    private function snapshot(?PaymentMethod $m): ?array
    {
        if (! $m) {
            return null;
        }
        $out = [];
        foreach (self::AUDITED as $k) {
            $v = $m->getAttribute($k);
            $out[$k] = $v instanceof \BackedEnum ? $v->value : $v;
        }

        return $out;
    }

    /** @param array<string, mixed> $input validated by PaymentMethodRequest */
    public function save(AdminContext $admin, array $input, ?string $id, ?string $password): PaymentMethod
    {
        $this->guard->confirm($admin, $password);
        $this->assertConsistent($input);
        $m = $id ? $this->find($id) : new PaymentMethod;
        $before = $this->snapshot($id ? $m : null);
        $data = [
            'type' => $input['type'],
            'displayName' => trim($input['displayName']),
            'accountNumber' => trim($input['accountNumber']),
            'accountName' => self::nullIfBlank($input['accountName'] ?? null),
            'accountType' => self::nullIfBlank($input['accountType'] ?? null),
            'bankName' => self::nullIfBlank($input['bankName'] ?? null),
            'branchName' => self::nullIfBlank($input['branchName'] ?? null),
            'routingNumber' => self::nullIfBlank($input['routingNumber'] ?? null),
            'instructions' => self::nullIfBlank($input['instructions'] ?? null),
            'minAmount' => self::nullIfBlank($input['minAmount'] ?? null),
            'maxAmount' => self::nullIfBlank($input['maxAmount'] ?? null),
            'requireProof' => (bool) ($input['requireProof'] ?? false),
            'requireSenderNumber' => (bool) ($input['requireSenderNumber'] ?? true),
            'active' => (bool) ($input['active'] ?? true),
            'updatedById' => $admin->userId,
        ];
        if (! $id) {
            $data['createdById'] = $admin->userId;
            $data['sortOrder'] = (int) ($input['sortOrder'] ?? ((int) PaymentMethod::query()->max('sortOrder') + 1));
        } elseif (isset($input['sortOrder'])) {
            $data['sortOrder'] = (int) $input['sortOrder'];
        }
        $m->forceFill($data)->save();
        $this->audit->log($id ? 'payment_method.update' : 'payment_method.create', $admin->actor(), null, 'payment_method', $m->id,
            ['before' => $before, 'after' => $this->snapshot($m->refresh())], $admin->ip, $admin->userAgent);

        return $m;
    }

    private function assertConsistent(array $i): void
    {
        $min = self::nullIfBlank($i['minAmount'] ?? null);
        $max = self::nullIfBlank($i['maxAmount'] ?? null);
        if ($min !== null && $max !== null && Money::cmp($max, $min) < 0) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The maximum must be at least the minimum.', ['field' => 'maxAmount']);
        }
        $number = preg_replace('/[\s-]/', '', (string) $i['accountNumber']) ?? '';
        if (in_array($i['type'], ['BKASH', 'NAGAD', 'ROCKET'], true) && ! preg_match('/^01[3-9]\d{8,9}$/', $number)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Enter the 11-digit wallet number (Rocket: 11 or 12 digits).', ['field' => 'accountNumber']);
        }
        if ($i['type'] === 'BANK' && (self::nullIfBlank($i['bankName'] ?? null) === null || self::nullIfBlank($i['accountName'] ?? null) === null)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Bank transfers need the bank name and the account holder name.', ['field' => 'bankName']);
        }
    }

    private static function nullIfBlank(mixed $v): ?string
    {
        return $v === null || trim((string) $v) === '' ? null : trim((string) $v);
    }

    /** Soft-deletes (history of requests keeps pointing at it). */
    public function delete(AdminContext $admin, string $id, ?string $password): void
    {
        $this->guard->confirm($admin, $password);
        $m = $this->find($id);
        $before = $this->snapshot($m);
        $m->forceFill(['active' => false, 'updatedById' => $admin->userId])->save();
        $m->delete();
        $this->audit->log('payment_method.delete', $admin->actor(), null, 'payment_method', $id, ['before' => $before, 'after' => null], $admin->ip, $admin->userAgent);
    }

    /** @param list<string> $ids full new order */
    public function reorder(AdminContext $admin, array $ids): void
    {
        $known = PaymentMethod::query()->pluck('sortOrder', 'id')->all();
        if (array_diff($ids, array_keys($known)) || count(array_unique($ids)) !== count($ids)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Unknown payment method in the new order.', ['field' => 'ids']);
        }
        DB::transaction(function () use ($ids) {
            foreach (array_values($ids) as $pos => $id) {
                PaymentMethod::query()->whereKey($id)->update(['sortOrder' => $pos + 1]);
            }
        });
        $this->audit->log('payment_method.reorder', $admin->actor(), null, 'payment_method', null, ['before' => $known, 'after' => array_flip(array_map(fn ($i) => $i, array_values($ids)))], $admin->ip, $admin->userAgent);
    }

    public function uploadQr(AdminContext $admin, string $id, UploadedFile $file, ?string $password): PaymentMethod
    {
        $this->guard->confirm($admin, $password);
        $m = $this->find($id);
        $stored = $this->storage->store('platform', $file, 'payment-methods');
        if (! in_array($stored['contentType'], ['image/png', 'image/jpeg'], true)) {
            $this->storage->delete($stored['key']);
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'QR codes must be PNG or JPG images.', ['field' => 'file']);
        }
        $before = $this->snapshot($m);
        $old = $m->qrImage['key'] ?? null;
        $m->forceFill(['qrImage' => $stored, 'updatedById' => $admin->userId])->save();
        if ($old) {
            $this->storage->delete($old);
        }
        $this->audit->log('payment_method.qr_update', $admin->actor(), null, 'payment_method', $id, ['before' => $before['qrImage'] ? ['name' => $before['qrImage']['name'] ?? null] : null, 'after' => ['name' => $stored['name'], 'size' => $stored['size']]], $admin->ip, $admin->userAgent);

        return $m;
    }

    /** @return array{body: string, contentType: string, name: string} */
    public function qr(string $id, bool $activeOnly): array
    {
        $m = $this->find($id, $activeOnly);
        $key = $m->qrImage['key'] ?? null;
        $body = $key ? $this->storage->get($key) : null;
        if ($body === null) {
            throw new AppException(ErrorCode::NOT_FOUND, 'No QR code for this payment method.');
        }

        return ['body' => $body, 'contentType' => (string) ($m->qrImage['contentType'] ?? 'image/png'), 'name' => (string) ($m->qrImage['name'] ?? 'qr.png')];
    }

    /** Customer-facing shape: receiving details only (no audit fields, no storage keys). */
    public static function publicShape(PaymentMethod $m): array
    {
        return [
            'id' => $m->id, 'type' => $m->type->value, 'displayName' => $m->displayName, 'accountNumber' => $m->accountNumber,
            'accountName' => $m->accountName, 'accountType' => $m->accountType, 'bankName' => $m->bankName, 'branchName' => $m->branchName,
            'routingNumber' => $m->routingNumber, 'instructions' => $m->instructions,
            'minAmount' => $m->minAmount !== null ? Money::round((string) $m->minAmount, 2) : null,
            'maxAmount' => $m->maxAmount !== null ? Money::round((string) $m->maxAmount, 2) : null,
            'requireProof' => $m->requireProof, 'requireSenderNumber' => $m->requireSenderNumber, 'hasQr' => ! empty($m->qrImage['key']),
        ];
    }

    public static function adminShape(PaymentMethod $m): array
    {
        return self::publicShape($m) + ['active' => $m->active, 'sortOrder' => $m->sortOrder, 'qrName' => $m->qrImage['name'] ?? null,
            'updatedAt' => Dhaka::iso($m->updatedAt), 'createdAt' => Dhaka::iso($m->createdAt)];
    }
}
