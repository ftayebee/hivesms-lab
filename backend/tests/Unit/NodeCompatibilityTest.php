<?php

namespace Tests\Unit;

use App\Services\Sms\MessageSegmentCalculator;
use App\Support\Crypto;
use App\Support\Phone;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The PHP ports must give byte-identical results to the Node code (fixtures produced by running
 * src/lib/{crypto,sms-segments,phone}.ts — see tests/Fixtures/node-compat.json). Segment counts
 * are billing; crypto formats protect secrets and API keys written by either backend.
 */
class NodeCompatibilityTest extends TestCase
{
    private static function fixtures(): array
    {
        return json_decode((string) file_get_contents(__DIR__.'/../Fixtures/node-compat.json'), true);
    }

    public static function segmentCases(): array
    {
        return array_map(fn ($c) => [$c], self::fixtures()['segments']);
    }

    #[DataProvider('segmentCases')]
    public function test_segmentation_matches_node(array $case): void
    {
        [$text, $encoding, $characters, $units, $segments, $remaining, $exceeds] = $case;
        $r = MessageSegmentCalculator::calculate($text);
        $this->assertSame([$encoding, $characters, $units, $segments, $remaining, $exceeds], [$r['encoding'], $r['characters'], $r['units'], $r['segments'], $r['remainingInSegment'], $r['exceedsMax']], mb_substr($text, 0, 30));
    }

    public static function phoneCases(): array
    {
        return array_map(fn ($c) => [$c], self::fixtures()['phones']);
    }

    #[DataProvider('phoneCases')]
    public function test_phone_normalisation_matches_node(array $case): void
    {
        [$input, $expected, $operator] = $case;
        $n = Phone::normalize($input);
        $this->assertSame($expected, $n, $input);
        if ($n) {
            $this->assertSame($operator, Phone::operator($n));
        }
    }

    public function test_hashes_match_node(): void
    {
        $f = self::fixtures();
        $this->assertSame($f['sha'], Crypto::sha256('token-value'));
        $this->assertSame($f['hmac'], Crypto::hmacSha256('test-api-key-pepper-0123456789abcdef012345', 'sfk_live_abcd1234_secret'));
    }
}
