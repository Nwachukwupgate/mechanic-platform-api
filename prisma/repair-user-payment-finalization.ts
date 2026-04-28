/* eslint-disable no-console */
import { BookingStatus, PaymentMethod, PrismaClient, TransactionStatus, TransactionType } from '@prisma/client';

type Args = {
  apply: boolean;
  references: string[];
};

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, references: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') {
      args.apply = true;
      continue;
    }
    if (a === '--reference' || a === '--ref') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args.references.push(next.trim());
        i += 1;
      }
      continue;
    }
    if (a.startsWith('--reference=')) {
      args.references.push(a.slice('--reference='.length).trim());
      continue;
    }
    if (a.startsWith('--ref=')) {
      args.references.push(a.slice('--ref='.length).trim());
      continue;
    }
  }
  args.references = [...new Set(args.references.map((r) => r.trim()).filter(Boolean))];
  return args;
}

async function verifyPaystack(reference: string): Promise<{ status: 'success' | 'failed'; amount: number } | null> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    throw new Error('PAYSTACK_SECRET_KEY is required to verify references');
  }
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const json = (await res.json()) as {
    status: boolean;
    data?: { status?: string; amount?: number };
  };
  if (!json.status || !json.data) return null;
  return {
    status: json.data.status === 'success' ? 'success' : 'failed',
    amount: typeof json.data.amount === 'number' ? json.data.amount : 0,
  };
}

async function reconcileBookingForTx(
  prisma: PrismaClient,
  txRow: {
    id: string;
    bookingId: string | null;
    amountMinor: number;
    paystackReference: string | null;
  },
  apply: boolean,
): Promise<'fixed' | 'skipped' | 'invalid'> {
  if (!txRow.bookingId) return 'invalid';
  const booking = await prisma.booking.findUnique({
    where: { id: txRow.bookingId },
    select: {
      id: true,
      paidAt: true,
      paymentMethod: true,
      paidAmount: true,
      paystackReference: true,
      status: true,
    },
  });
  if (!booking) return 'invalid';
  if (booking.paymentMethod && booking.paymentMethod !== PaymentMethod.PLATFORM) {
    return 'invalid';
  }

  const alreadyOk =
    booking.paidAt != null &&
    booking.paymentMethod === PaymentMethod.PLATFORM &&
    booking.paidAmount != null &&
    booking.status === BookingStatus.PAID;
  if (alreadyOk) return 'skipped';

  if (!apply) return 'fixed';

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      paidAt: booking.paidAt ?? new Date(),
      paymentMethod: PaymentMethod.PLATFORM,
      paidAmount: booking.paidAmount != null && booking.paidAmount > 0 ? booking.paidAmount : txRow.amountMinor / 100,
      paystackReference: booking.paystackReference ?? txRow.paystackReference ?? undefined,
      status: BookingStatus.PAID,
    },
  });
  return 'fixed';
}

async function main() {
  const { apply, references } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    console.log(`Mode: ${apply ? 'APPLY' : 'DRY_RUN'}`);

    const successRows = await prisma.transaction.findMany({
      where: { type: TransactionType.USER_PAYMENT, status: TransactionStatus.SUCCESS },
      select: { id: true, bookingId: true, amountMinor: true, paystackReference: true, reference: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    let fixed = 0;
    let skipped = 0;
    let invalid = 0;

    for (const row of successRows) {
      const out = await reconcileBookingForTx(prisma, row, apply);
      if (out === 'fixed') {
        fixed += 1;
        console.log(`[${apply ? 'fixed' : 'would-fix'}] SUCCESS tx=${row.id} booking=${row.bookingId} ref=${row.paystackReference ?? row.reference ?? '-'}`);
      } else if (out === 'skipped') {
        skipped += 1;
      } else {
        invalid += 1;
        console.log(`[skip-invalid] SUCCESS tx=${row.id} booking=${row.bookingId} ref=${row.paystackReference ?? row.reference ?? '-'}`);
      }
    }

    if (references.length) {
      console.log(`Checking explicit references (${references.length}) against Paystack...`);
    }
    for (const ref of references) {
      const verify = await verifyPaystack(ref);
      if (!verify || verify.status !== 'success') {
        console.log(`[skip] ref=${ref} not successful on Paystack`);
        continue;
      }
      const txRow = await prisma.transaction.findFirst({
        where: {
          type: TransactionType.USER_PAYMENT,
          OR: [{ paystackReference: ref }, { reference: ref }],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!txRow) {
        console.log(`[missing] ref=${ref} successful on Paystack but no USER_PAYMENT transaction found`);
        continue;
      }

      if (txRow.status !== TransactionStatus.SUCCESS) {
        if (apply) {
          await prisma.transaction.update({
            where: { id: txRow.id },
            data: { status: TransactionStatus.SUCCESS },
          });
          console.log(`[fixed] tx status PENDING->SUCCESS for ref=${ref} tx=${txRow.id}`);
        } else {
          console.log(`[would-fix] tx status PENDING->SUCCESS for ref=${ref} tx=${txRow.id}`);
        }
      }

      const out = await reconcileBookingForTx(
        prisma,
        {
          id: txRow.id,
          bookingId: txRow.bookingId,
          amountMinor: verify.amount || txRow.amountMinor,
          paystackReference: txRow.paystackReference ?? ref,
        },
        apply,
      );
      if (out === 'fixed') {
        fixed += 1;
        console.log(`[${apply ? 'fixed' : 'would-fix'}] booking reconcile for ref=${ref} booking=${txRow.bookingId}`);
      } else if (out === 'invalid') {
        invalid += 1;
        console.log(`[skip-invalid] cannot reconcile booking for ref=${ref} tx=${txRow.id}`);
      }
    }

    console.log('\nSummary');
    console.log(`  ${apply ? 'fixed' : 'would-fix'} bookings: ${fixed}`);
    console.log(`  already-consistent: ${skipped}`);
    console.log(`  invalid/skipped: ${invalid}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

