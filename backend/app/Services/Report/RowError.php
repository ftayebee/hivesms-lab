<?php

namespace App\Services\Report;

use RuntimeException;

/** A report-import row that cannot be imported; its message is shown to the admin with the line number. */
final class RowError extends RuntimeException {}
