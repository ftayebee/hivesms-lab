<?php

namespace Tests\Unit;

use App\Services\Sms\SmsCostCalculator;
use App\Support\Money;
use PHPUnit\Framework\TestCase;

class MoneyAndPricingTest extends TestCase
{
    public function test_rounding_is_half_up_without_floating_point_error(): void
    {
        $this->assertSame('1.01', Money::round('1.005', 2));
        $this->assertSame('1.00', Money::round('1.0049', 2));
        $this->assertSame('-1.01', Money::round('-1.005', 2));
        $this->assertSame('0.30', Money::round(Money::add('0.1', '0.2'), 2));
        $this->assertSame('0.3500', Money::round('0.35', 4));
        $this->assertSame('0.35', Money::plain('0.3500'));
        $this->assertSame('5', Money::plain('5.0000'));
    }

    public function test_message_cost_is_segments_times_recipients_times_rate(): void
    {
        $this->assertSame('1.2000', SmsCostCalculator::messageCost(3, 1, '0.40'));
        $this->assertSame('3500.0000', SmsCostCalculator::messageCost(1, 10000, '0.35'));
        $this->assertSame('0.0001', SmsCostCalculator::messageCost(1, 1, '0.00005'));
    }

    public function test_top_up_breakdown_charges_vat_and_credits_bonus(): void
    {
        $b = SmsCostCalculator::topUpBreakdown('5000', '15', '2');
        $this->assertSame(['5000.00', '15', '750.00', '5750.00', '100.00', '5100.00'], [$b['subtotal'], $b['vatRate'], $b['vatAmount'], $b['total'], $b['bonus'], $b['creditAmount']]);
    }

    public function test_format_bdt(): void
    {
        $this->assertSame('BDT 1,234.50', Money::formatBdt('1234.5'));
    }
}
