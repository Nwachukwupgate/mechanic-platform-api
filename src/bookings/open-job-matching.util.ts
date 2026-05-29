/** Same radius as `findOpenRequestsForMechanic` default. */
export const OPEN_JOB_MATCH_RADIUS_KM = 50;

export type OpenJobMatchProfile = {
  mechanicId: string;
  expertise: string[];
  vehicleTypes: string[];
  latitude: number | null;
  longitude: number | null;
  availability: boolean;
  isVerified: boolean;
  emailVerified: boolean;
  deletedAt: Date | null;
};

export type OpenJobMatchBooking = {
  locationLat: number | null;
  locationLng: number | null;
  faultCategory: string;
  vehicleType: string;
  expertiseMapped: string;
};

/** Mirrors open-board listing rules in BookingsService.findOpenRequestsForMechanic. */
export function mechanicProfileMatchesOpenJob(
  profile: OpenJobMatchProfile,
  booking: OpenJobMatchBooking,
  distanceKm: number | null,
  radiusKm: number = OPEN_JOB_MATCH_RADIUS_KM,
): boolean {
  if (!profile.availability) return false;
  if (!profile.isVerified || !profile.emailVerified || profile.deletedAt) return false;

  const matchesFault =
    profile.expertise.includes(booking.expertiseMapped) ||
    profile.expertise.includes(booking.faultCategory);
  if (!matchesFault) return false;

  if (profile.vehicleTypes.length > 0) {
    const normalisedTypes = profile.vehicleTypes.map((t) =>
      t === 'SEDAN' ? 'SALOON' : t,
    );
    if (!normalisedTypes.includes(booking.vehicleType)) return false;
  }

  const hasMechanicLocation =
    profile.latitude != null && profile.longitude != null;
  if (
    booking.locationLat != null &&
    booking.locationLng != null &&
    hasMechanicLocation &&
    distanceKm != null
  ) {
    return distanceKm <= radiusKm;
  }
  return true;
}
