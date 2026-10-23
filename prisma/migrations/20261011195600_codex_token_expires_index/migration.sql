-- Index the token-refresh scheduler and cleanup queries, which filter on expiresAt every minute.
CREATE INDEX "CodexToken_expiresAt_idx" ON "CodexToken"("expiresAt");
