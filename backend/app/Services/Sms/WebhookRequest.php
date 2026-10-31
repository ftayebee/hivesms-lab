<?php

namespace App\Services\Sms;

use Illuminate\Http\Request;

/** Raw webhook request as seen by a provider adapter (headers lower-cased). */
final class WebhookRequest
{
    /**
     * @param  array<string, string>  $headers
     * @param  array<string, mixed>  $query
     */
    public function __construct(
        public readonly array $headers,
        public readonly string $rawBody,
        public readonly array $query,
    ) {}

    public static function fromRequest(Request $request): self
    {
        $headers = [];
        foreach ($request->headers->all() as $k => $v) {
            $headers[strtolower($k)] = is_array($v) ? (string) ($v[0] ?? '') : (string) $v;
        }

        return new self($headers, (string) $request->getContent(), $request->query->all());
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function isJson(): bool
    {
        return str_contains($this->header('content-type') ?? '', 'json');
    }

    /** @return array<string, mixed> JSON or form body */
    public function body(): array
    {
        if ($this->isJson()) {
            $decoded = json_decode($this->rawBody, true);

            return is_array($decoded) ? $decoded : [];
        }
        parse_str($this->rawBody, $out);

        return $out;
    }
}
