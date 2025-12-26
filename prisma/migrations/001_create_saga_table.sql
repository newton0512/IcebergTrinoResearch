-- Create Saga table for tracking saga execution state
CREATE TABLE IF NOT EXISTS "Saga" (
  id        VARCHAR(255) PRIMARY KEY,
  status    VARCHAR(50) NOT NULL,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

-- Create index on status for faster queries
CREATE INDEX IF NOT EXISTS idx_saga_status ON "Saga"(status);

-- Create index on createdAt for time-based queries
CREATE INDEX IF NOT EXISTS idx_saga_created_at ON "Saga"("createdAt");

