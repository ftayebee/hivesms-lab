<?php

namespace App\Http\Requests\Messaging;

use App\Exceptions\AppException;
use App\Http\Requests\ApiRequest;
use App\Services\Messaging\ComplianceService;
use App\Services\Platform\SettingsService;
use App\Services\Sms\MessageSegmentCalculator;
use Closure;

/** Template body: ≤ 1,600 chars, valid {{placeholders}}, not over the segment limit, no blocked content. */
class TemplateRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:1', 'max:80'],
            'body' => ['required', 'string', 'min:1', 'max:1600', function (string $a, mixed $v, Closure $fail) {
                if (preg_match('/\{\{(?!\s*[a-zA-Z0-9_]+\s*\}\})/', (string) $v)) {
                    $fail('Placeholders look like {{name}}: letters, digits and underscores only.');
                }
                $policy = app(SettingsService::class)->smsPolicy();
                if (MessageSegmentCalculator::calculate((string) $v, $policy['segmentation'])['exceedsMax']) {
                    $fail("The text needs more than {$policy['segmentation']['maxSegments']} SMS segments.");
                }
                try {
                    app(ComplianceService::class)->assertContentAllowed((string) $v);
                } catch (AppException $e) {
                    $fail($e->getMessage());
                }
            }],
            'smsType' => ['nullable', 'in:TRANSACTIONAL,PROMOTIONAL'],
        ];
    }

    public function messages(): array
    {
        return ['name.required' => 'Enter a template name.', 'body.required' => 'Enter the message text.', 'body.max' => 'Templates can be at most 1,600 characters.'];
    }

    /** @return array{name: string, body: string, smsType: string} */
    public function payload(): array
    {
        return ['name' => trim($this->input('name')), 'body' => trim($this->input('body')), 'smsType' => $this->input('smsType') ?: 'TRANSACTIONAL'];
    }
}
