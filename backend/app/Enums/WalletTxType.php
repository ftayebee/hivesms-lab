<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum WalletTxType). */
enum WalletTxType: string
{
    case CREDIT = 'CREDIT';
    case DEBIT = 'DEBIT';
}
