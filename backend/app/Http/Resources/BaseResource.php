<?php

namespace App\Http\Resources;

use App\Support\Dhaka;
use App\Support\Money;
use BackedEnum;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Http\Resources\MissingValue;

/**
 * Base for API resources: every resource lists its fields explicitly (secrets such as passwordHash,
 * keyHash, tokenHash or secretEncrypted can therefore never be serialized by accident).
 *
 * Conventions of the dashboard API: camelCase keys (the column names), enums as their string
 * values, dates as ISO-8601 UTC with milliseconds ("…Z"), money as decimal strings. Columns that
 * were not selected are omitted instead of failing (models run in strict mode outside production).
 */
abstract class BaseResource extends JsonResource
{
    protected function loaded(string $key): bool
    {
        return array_key_exists($key, $this->resource->getAttributes());
    }

    /** Raw attribute (cast), or omitted when not selected. */
    protected function f(string $key): mixed
    {
        if (! $this->loaded($key)) {
            return new MissingValue;
        }
        $v = $this->resource->getAttribute($key);

        return $v instanceof BackedEnum ? $v->value : $v;
    }

    protected function date(string $key): mixed
    {
        return $this->loaded($key) ? Dhaka::iso($this->resource->getAttribute($key)) : new MissingValue;
    }

    protected function money(string $key, int $dp = 2): mixed
    {
        if (! $this->loaded($key)) {
            return new MissingValue;
        }
        $v = $this->resource->getAttribute($key);

        return $v === null ? null : Money::round((string) $v, $dp);
    }
}
