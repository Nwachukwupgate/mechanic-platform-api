# User Payment Recovery Queries

Use these to diagnose cases where Paystack shows success but mechanic balance did not increase.

## 1) SQL: find inconsistent successful user payments

```sql
SELECT
  t.id                    AS tx_id,
  t."paystackReference"   AS paystack_ref,
  t.status                AS tx_status,
  t."bookingId"           AS booking_id,
  t."amountMinor"         AS amount_minor,
  b.status                AS booking_status,
  b."paymentMethod"       AS booking_payment_method,
  b."paidAt"              AS booking_paid_at,
  b."paidAmount"          AS booking_paid_amount
FROM "Transaction" t
LEFT JOIN "Booking" b ON b.id = t."bookingId"
WHERE t.type = 'USER_PAYMENT'
  AND t.status = 'SUCCESS'
  AND (
    b.id IS NULL
    OR b."paymentMethod" IS DISTINCT FROM 'PLATFORM'
    OR b."paidAt" IS NULL
    OR b.status <> 'PAID'
  )
ORDER BY t."createdAt" DESC;
```

## 2) SQL: inspect one Paystack reference

```sql
SELECT
  t.id, t.type, t.status, t.reference, t."paystackReference", t."bookingId", t."amountMinor", t."createdAt",
  b.status AS booking_status, b."paymentMethod", b."paidAt", b."paidAmount", b."mechanicId"
FROM "Transaction" t
LEFT JOIN "Booking" b ON b.id = t."bookingId"
WHERE t.type = 'USER_PAYMENT'
  AND (t."paystackReference" = $1 OR t.reference = $1)
ORDER BY t."createdAt" DESC;
```

## 3) Prisma snippet (same inconsistency check)

```ts
const rows = await prisma.transaction.findMany({
  where: {
    type: 'USER_PAYMENT',
    status: 'SUCCESS',
    OR: [
      { booking: null },
      { booking: { paymentMethod: { not: 'PLATFORM' } } },
      { booking: { paidAt: null } },
      { booking: { status: { not: 'PAID' } } },
    ],
  },
  include: {
    booking: {
      select: {
        id: true,
        status: true,
        paymentMethod: true,
        paidAt: true,
        paidAmount: true,
        mechanicId: true,
      },
    },
  },
  orderBy: { createdAt: 'desc' },
});
```

## 4) One-time repair script

Dry run:

```bash
npx ts-node prisma/repair-user-payment-finalization.ts
```

Apply fixes:

```bash
npx ts-node prisma/repair-user-payment-finalization.ts --apply
```

Target specific references (also verifies Paystack before applying):

```bash
npx ts-node prisma/repair-user-payment-finalization.ts --apply --reference <paystack_ref_1> --reference <paystack_ref_2>
```

Script behavior:
- Reconciles any `USER_PAYMENT SUCCESS` rows whose bookings are not fully marked `PLATFORM + PAID`.
- For explicit references, verifies Paystack; if successful, can promote `PENDING -> SUCCESS` and then reconcile booking.
