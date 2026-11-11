<?php

namespace App\Enums;

/** payment_methods.type: manual receiving channels configured by the Super Admin. */
enum PaymentMethodType: string
{
    case BKASH = 'BKASH';
    case NAGAD = 'NAGAD';
    case ROCKET = 'ROCKET';
    case BANK = 'BANK';
    case OTHER = 'OTHER';
}
