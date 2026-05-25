import { BadRequestException } from '@nestjs/common';

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
  const photos = booking.photoUrls?.length ?? 0;
  if (isVagueFaultName(booking.fault?.name) && photos < MIN_PHOTOS_VAGUE_FAULT) {
    return false;
  }
  return true;
}

