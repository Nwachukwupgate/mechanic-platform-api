-- Catch-all faults for issues not in the main catalogue (idempotent).
-- Electrical → FaultCategory.ELECTRICAL → matches ELECTRICAL expertise.
-- Mechanical uses ENGINE so mapFaultCategoryToExpertise maps to MECHANICAL.

INSERT INTO "Fault" ("id", "category", "name", "description", "questions", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
  'ELECTRICAL'::"FaultCategory",
  'Other electrical issue (not listed)',
  'Lights, sensors, wiring, accessories, or other electrical work not covered above. Add details and photos below.',
  '[{"question":"What symptoms or parts are involved?","type":"text"},{"question":"Any warning lights or blown fuses?","type":"text"},{"question":"Anything else we should know?","type":"text"}]'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "Fault" WHERE "name" = 'Other electrical issue (not listed)'
);

INSERT INTO "Fault" ("id", "category", "name", "description", "questions", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
  'ENGINE'::"FaultCategory",
  'Other mechanical issue (not listed)',
  'Engine, drivetrain, or related mechanical problem not covered above. Use notes and photos to explain.',
  '[{"question":"What are the main symptoms?","type":"text"},{"question":"When did it start?","type":"text"},{"question":"Any warning lights or unusual sounds?","type":"text"}]'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "Fault" WHERE "name" = 'Other mechanical issue (not listed)'
);
