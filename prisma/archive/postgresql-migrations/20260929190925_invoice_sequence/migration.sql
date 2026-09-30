-- Gap-free-enough, race-free invoice numbering (INV-<year>-<number>).
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 1001 INCREMENT BY 1;

-- Wallet balances must never go negative, even if application code has a bug.
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_non_negative" CHECK (balance >= 0);

-- Ledger amounts are always positive; the type column gives the direction.
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_amount_positive" CHECK (amount > 0);
