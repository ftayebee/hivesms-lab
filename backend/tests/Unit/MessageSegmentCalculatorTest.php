<?php

namespace Tests\Unit;

use App\Services\Sms\MessageSegmentCalculator as Seg;
use PHPUnit\Framework\TestCase;

class MessageSegmentCalculatorTest extends TestCase
{
    public function test_plain_english_is_gsm7_single_segment(): void
    {
        $r = Seg::calculate('Your OTP is 123456');
        $this->assertSame('GSM7', $r['encoding']);
        $this->assertSame(1, $r['segments']);
        $this->assertSame(18, $r['units']);
    }

    public function test_gsm7_boundaries_160_and_153(): void
    {
        $this->assertSame(1, Seg::calculate(str_repeat('x', 160))['segments']);
        $this->assertSame(2, Seg::calculate(str_repeat('x', 161))['segments']);
        $this->assertSame(2, Seg::calculate(str_repeat('x', 306))['segments']);
        $this->assertSame(3, Seg::calculate(str_repeat('x', 307))['segments']);
    }

    public function test_extension_table_characters_count_double_and_are_not_split(): void
    {
        $r = Seg::calculate('{}[]~\\|^€');
        $this->assertSame('GSM7', $r['encoding']);
        $this->assertSame(18, $r['units']);
        // 159 + € (2 units) = 161 > 160 → multipart; 152 + € fits one 160-unit SMS (154 units).
        $this->assertSame(2, Seg::calculate(str_repeat('a', 159).'€')['segments']);
        $this->assertSame(1, Seg::calculate(str_repeat('a', 152).'€')['segments']);
        // 152 + € + 152 = 306 units (naively 2 × 153), but the escape pair cannot straddle parts:
        // part 1 = 152, part 2 = € + 151, part 3 = 1 → 3 segments.
        $this->assertSame(3, Seg::calculate(str_repeat('a', 152).'€'.str_repeat('a', 152))['segments']);
    }

    public function test_bangla_is_ucs2_70_and_67(): void
    {
        $r = Seg::calculate('আপনার অর্ডার পাঠানো হয়েছে');
        $this->assertSame('UCS2', $r['encoding']);
        $this->assertSame(1, $r['segments']);
        $this->assertSame(1, Seg::calculate(str_repeat('ক', 70))['segments']);
        $this->assertSame(2, Seg::calculate(str_repeat('ক', 71))['segments']);
        $this->assertSame(3, Seg::calculate(str_repeat('ক', 135))['segments']);
    }

    public function test_one_non_gsm_character_switches_the_whole_message_to_ucs2(): void
    {
        $r = Seg::calculate(str_repeat('a', 100).'ব');
        $this->assertSame('UCS2', $r['encoding']);
        $this->assertSame(2, $r['segments']);
        $this->assertSame(['ব'], $r['nonGsmCharacters']);
    }

    public function test_emoji_counts_two_utf16_units_and_is_never_split(): void
    {
        $this->assertSame(70, Seg::calculate(str_repeat('😀', 35))['units']);
        $this->assertSame(1, Seg::calculate(str_repeat('😀', 35))['segments']);
        $this->assertSame(2, Seg::calculate(str_repeat('😀', 36))['segments']);
    }

    public function test_max_segments_flag_and_custom_rules(): void
    {
        $this->assertTrue(Seg::calculate(str_repeat('a', 1531))['exceedsMax']);
        $rules = ['gsm7' => ['single' => 150, 'multipart' => 140], 'ucs2' => ['single' => 60, 'multipart' => 50], 'maxSegments' => 2];
        $this->assertSame(2, Seg::calculate(str_repeat('a', 151), $rules)['segments']);
        $this->assertTrue(Seg::calculate(str_repeat('a', 281), $rules)['exceedsMax']);
    }

    public function test_empty_message_has_zero_segments(): void
    {
        $this->assertSame(0, Seg::calculate('')['segments']);
    }

    public function test_template_rendering_and_variables(): void
    {
        $this->assertSame('Hi Rahim, your code is .', Seg::renderTemplate('Hi {{ name }}, your code is {{code}}.', ['name' => 'Rahim']));
        $this->assertSame(['name', 'code'], Seg::extractVariables('Hi {{name}} {{ code }} {{name}}'));
    }
}
