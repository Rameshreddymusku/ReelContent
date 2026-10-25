/**
 * Firestore Security Rules Test Suite (Dirty Dozen Verification)
 */
export interface DirtyPayloadTest {
  id: number;
  name: string;
  collection: string;
  operation: 'create' | 'update' | 'get' | 'list';
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyPayloadTest[] = [
  { id: 1, name: 'Identity Spoofing on Booking Create', collection: 'bookings', operation: 'create', expectedResult: 'PERMISSION_DENIED' },
  { id: 2, name: 'Shadow Field Injection on Booking Create', collection: 'bookings', operation: 'create', expectedResult: 'PERMISSION_DENIED' },
  { id: 3, name: 'Unverified Email Write', collection: 'bookings', operation: 'create', expectedResult: 'PERMISSION_DENIED' },
  { id: 4, name: 'Forged Client Timestamp', collection: 'bookings', operation: 'create', expectedResult: 'PERMISSION_DENIED' },
  { id: 5, name: 'ID Poisoning Attack', collection: 'bookings', operation: 'create', expectedResult: 'PERMISSION_DENIED' },
  { id: 6, name: 'Value Poisoning on Booking Price', collection: 'bookings', operation: 'create', expectedResult: 'PERMISSION_DENIED' },
  { id: 7, name: 'Terminal State Mutation', collection: 'bookings', operation: 'update', expectedResult: 'PERMISSION_DENIED' },
  { id: 8, name: 'Immutable Field Tampering', collection: 'bookings', operation: 'update', expectedResult: 'PERMISSION_DENIED' },
  { id: 9, name: 'Cross-User PII Read on Bookings', collection: 'bookings', operation: 'get', expectedResult: 'PERMISSION_DENIED' },
  { id: 10, name: 'Unconstrained List Scraping', collection: 'bookings', operation: 'list', expectedResult: 'PERMISSION_DENIED' },
  { id: 11, name: 'Admin Email Spoof Without Verification', collection: 'bookings', operation: 'get', expectedResult: 'PERMISSION_DENIED' },
  { id: 12, name: 'Oversized Message DoW Attack', collection: 'inquiries', operation: 'create', expectedResult: 'PERMISSION_DENIED' },
];
