import { BadRequestException } from '@nestjs/common';

/** Minimum characters for open-board job posts (bidding). */
export const MIN_OPEN_JOB_DESCRIPTION_LENGTH = 50;

/** Minimum characters when requesting a specific mechanic directly. */
export const MIN_DIRECT_JOB_DESCRIPTION_LENGTH = 30;

/** Photos required for catch-all fault categories on open jobs. */
export const MIN_PHOTOS_VAGUE_FAULT = 2;

/** Encouraged photo count for all open jobs (client-side). */
export const RECOMMENDED_JOB_PHOTOS = 2;

export const MAX_CLARIFICATIONS_PER_BOOKING = 10;
export const MAX_CLARIFICATIONS_PER_MECHANIC = 3;

export function isVagueFaultName(faultName: string | undefined | null): boolean {
  const n = (faultName ?? '').toLowerCase();
  return n.includes('other mechanical') || n.includes('other electrical');
}

export function validateJobDescription(
  description: string | undefined | null,
  isOpenBoard: boolean,
): void {
  const trimmed = (description ?? '').trim();
  const min = isOpenBoard
    ? MIN_OPEN_JOB_DESCRIPTION_LENGTH
    : MIN_DIRECT_JOB_DESCRIPTION_LENGTH;
  if (trimmed.length < min) {
    throw new BadRequestException(
      isOpenBoard
        ? `Describe the issue in at least ${min} characters so mechanics can quote accurately (when it started, symptoms, warning lights, etc.).`
        : `Add a short description (at least ${min} characters) so the mechanic understands the job.`,
    );
  }
}

export function validateOpenJobPhotos(
  photoCount: number,
  faultName: string | undefined | null,
): void {
  if (isVagueFaultName(faultName) && photoCount < MIN_PHOTOS_VAGUE_FAULT) {
    throw new BadRequestException(
      `Add at least ${MIN_PHOTOS_VAGUE_FAULT} clear photos for this type of issue so mechanics can diagnose before quoting.`,
    );
  }
}

/** Open-board jobs must meet quality bar before appearing to mechanics. */
export function meetsOpenJobListingRequirements(booking: {
  description?: string | null;
  photoUrls?: string[] | null;
  fault?: { name?: string | null } | null;
}): boolean {
  const desc = (booking.description ?? '').trim();
  if (desc.length < MIN_OPEN_JOB_DESCRIPTION_LENGTH) return false;
  const photos = booking.photoUrls?.length ?? 0;
  if (isVagueFaultName(booking.fault?.name) && photos < MIN_PHOTOS_VAGUE_FAULT) {
    return false;
  }
  return true;
}

/** Strip customer phone from open-board payloads (contact stays in-app until quote accepted). */
export function sanitizeUserForOpenBoard<T extends { profile?: { phone?: string | null } | null }>(
  user: T,
): T {
  if (!user?.profile) return user;
  return {
    ...user,
    profile: { ...user.profile, phone: null },
  };
}

/** Hide mechanic workshop phone while job is still in REQUESTED (pre-acceptance). */
export function sanitizeMechanicForBidding<
  T extends { profile?: { phone?: string | null } | null; phone?: string | null },
>(mechanic: T): T {
  if (!mechanic) return mechanic;
  const profile = mechanic.profile
    ? { ...mechanic.profile, phone: null }
    : mechanic.profile;
  return { ...mechanic, phone: null, profile };
}
