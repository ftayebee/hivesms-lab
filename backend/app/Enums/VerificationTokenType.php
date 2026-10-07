<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum VerificationTokenType). */
enum VerificationTokenType: string
{
    case EMAIL_VERIFY = 'EMAIL_VERIFY';
    case PASSWORD_RESET = 'PASSWORD_RESET';
    case PHONE_OTP = 'PHONE_OTP';
}
