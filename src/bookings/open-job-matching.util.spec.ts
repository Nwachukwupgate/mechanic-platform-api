import {
  mechanicProfileMatchesOpenJob,
  OPEN_JOB_MATCH_RADIUS_KM,
  OpenJobMatchBooking,
  OpenJobMatchProfile,
} from './open-job-matching.util';

const baseProfile: OpenJobMatchProfile = {
  mechanicId: 'm1',
  expertise: ['MECHANICAL'],
  vehicleTypes: ['SALOON'],
  latitude: 6.5,
  longitude: 3.4,
  availability: true,
  isVerified: true,
  emailVerified: true,
  deletedAt: null,
};

const baseBooking: OpenJobMatchBooking = {
  locationLat: 6.51,
  locationLng: 3.41,
  faultCategory: 'ENGINE',
  vehicleType: 'SALOON',
  expertiseMapped: 'MECHANICAL',
};

describe('mechanicProfileMatchesOpenJob', () => {
  it('matches when expertise and vehicle type align within radius', () => {
    expect(
      mechanicProfileMatchesOpenJob(baseProfile, baseBooking, 2),
    ).toBe(true);
  });

  it('rejects when outside radius', () => {
    expect(
      mechanicProfileMatchesOpenJob(
        baseProfile,
        baseBooking,
        OPEN_JOB_MATCH_RADIUS_KM + 1,
      ),
    ).toBe(false);
  });

  it('rejects unavailable mechanics', () => {
    expect(
      mechanicProfileMatchesOpenJob(
        { ...baseProfile, availability: false },
        baseBooking,
        2,
      ),
    ).toBe(false);
  });

  it('allows any location when booking has no coordinates', () => {
    expect(
      mechanicProfileMatchesOpenJob(
        baseProfile,
        { ...baseBooking, locationLat: null, locationLng: null },
        null,
      ),
    ).toBe(true);
  });

  it('rejects when vehicle type is not supported', () => {
    expect(
      mechanicProfileMatchesOpenJob(
        { ...baseProfile, vehicleTypes: ['TRUCK'] },
        baseBooking,
        2,
      ),
    ).toBe(false);
  });
});
