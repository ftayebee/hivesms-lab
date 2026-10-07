<?php

namespace App\Services\Template;

use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Models\Template;
use App\Services\Platform\AuditLogger;
use App\Support\ErrorCode;
use Illuminate\Database\Eloquent\Collection;

/** Message templates (port of features/templates/service.ts). */
class TemplateService
{
    private const MAX_TEMPLATES = 500;

    public function __construct(private readonly AuditLogger $audit) {}

    /** @return Collection<int, Template> newest-updated first, at most 200 (as before) */
    public function list(TenantContext $ctx, ?string $q = null): Collection
    {
        $ctx->requirePermission('templates:read');

        return Template::query()
            ->where('organizationId', $ctx->organizationId)
            ->when($q, fn ($w) => $w->where(fn ($x) => $x->where('name', 'like', '%'.addcslashes($q, '%_\\').'%')->orWhere('body', 'like', '%'.addcslashes($q, '%_\\').'%')))
            ->orderByDesc('updatedAt')
            ->limit(200)
            ->get();
    }

    public function find(TenantContext $ctx, string $id): Template
    {
        $ctx->requirePermission('templates:read');

        return Template::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Template not found.');
    }

    /** @param array{name: string, body: string, smsType: string} $input */
    public function save(TenantContext $ctx, array $input, ?string $id = null): Template
    {
        $ctx->requirePermission('templates:write');
        if ($id) {
            $t = Template::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
                ?? throw new AppException(ErrorCode::NOT_FOUND, 'Template not found.');
            $t->forceFill($input)->save();
            $this->audit->log('template.update', $ctx->actor(), $ctx->organizationId, 'template', $id);

            return $t;
        }
        if (Template::query()->where('organizationId', $ctx->organizationId)->count() >= self::MAX_TEMPLATES) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'You can keep up to 500 templates.');
        }
        $t = Template::query()->forceCreate($input + ['organizationId' => $ctx->organizationId, 'createdById' => $ctx->userId]);
        $this->audit->log('template.create', $ctx->actor(), $ctx->organizationId, 'template', $t->id);

        return $t;
    }

    public function delete(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('templates:write');
        $t = Template::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Template not found.');
        $t->delete();
        $this->audit->log('template.delete', $ctx->actor(), $ctx->organizationId, 'template', $id);
    }
}
