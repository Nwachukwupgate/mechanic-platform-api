/** Permission keys stored in User.adminPermissions (JSON string array) for ADMIN users. */
export const ADMIN_PERMISSIONS = {
  READ: 'read',
  /** Dashboard aggregates (users/bookings/revenue counts). */
  OVERVIEW: 'overview',
  USERS: 'users',
  MECHANICS: 'mechanics',
  BOOKINGS: 'bookings',
  PAYMENTS: 'payments',
  COMPLAINTS: 'complaints',
  ADMINS: 'admins',
  AUDIT: 'audit',
} as const;

export type PermissionKey = (typeof ADMIN_PERMISSIONS)[keyof typeof ADMIN_PERMISSIONS];
