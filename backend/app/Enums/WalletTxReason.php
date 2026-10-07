<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum WalletTxReason). */
enum WalletTxReason: string
{
    case TOPUP = 'TOPUP';
    case BONUS = 'BONUS';
    case SMS_CHARGE = 'SMS_CHARGE';
    case REFUND = 'REFUND';
    case ADJUSTMENT = 'ADJUSTMENT';
    case SENDER_ID_FEE = 'SENDER_ID_FEE';
}
