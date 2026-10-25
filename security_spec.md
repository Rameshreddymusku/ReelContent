# Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Global Default-Deny**: All unlisted paths are strictly denied (`allow read, write: if false;`).
2. **Verified Identity**: Every write operation requires an authenticated user with a verified email (`request.auth != null && request.auth.token.email_verified == true`).
3. **Owner & Admin Access (`Booking`)**:
   - A `Booking` document can only be created if `incoming().userId == request.auth.uid` and all 16 required keys match the strict schema and volumetric bounds.
   - `createdAt` and `updatedAt` must equal `request.time`.
   - PII isolation: Only the booking owner (`resource.data.userId == request.auth.uid`) or a verified Studio Admin (`isAdmin()`) can read or list bookings.
   - Terminal State Locking: Once `resource.data.status == 'CANCELLED'`, no non-admin updates are permitted.
   - Action-Based Updates: Owners may only perform:
     - **Cancel Action**: Transition `status` from `'CONFIRMED'` to `'CANCELLED'` along with `updatedAt == request.time`.
     - **Mark Gmail Sent Action**: Update `gmailSent` from `false` to `true` along with `updatedAt == request.time`.
4. **Owner & Admin Access (`ContactInquiry`)**:
   - A `ContactInquiry` document can only be created if `incoming().userId == request.auth.uid` and `incoming().createdAt == request.time`.
   - Inquiries are immutable after creation (no client updates). Only the creator or `isAdmin()` may read them.
5. **Owner & Admin Access (`RegionVisit`)**:
   - Document ID `{visitId}` must equal `request.auth.uid` so each user maintains their own regional check-in record.
   - Only the owner (`request.auth.uid == visitId`) or `isAdmin()` can read/list regional visits.

## 2. The "Dirty Dozen" Payloads
1. **Payload 1 (Identity Spoofing on Booking Create)**: `userId` set to `"another-user-uid"` while authenticated as `"attacker-uid"`. -> `PERMISSION_DENIED`
2. **Payload 2 (Shadow Field Injection on Booking Create)**: Valid booking payload plus `"isAdmin": true`. -> `PERMISSION_DENIED`
3. **Payload 3 (Unverified Email Write)**: Valid booking payload sent by a user with `email_verified: false`. -> `PERMISSION_DENIED`
4. **Payload 4 (Forged Client Timestamp)**: `createdAt` set to a past timestamp instead of `request.time`. -> `PERMISSION_DENIED`
5. **Payload 5 (ID Poisoning Attack)**: Document ID containing spaces or special characters (`"bad/id$123"`). -> `PERMISSION_DENIED`
6. **Payload 6 (Value Poisoning on Booking Price)**: `price` set to `-500` or string `"129"`. -> `PERMISSION_DENIED`
7. **Payload 7 (Terminal State Mutation)**: Attempting to update a booking whose `existing().status == 'CANCELLED'` back to `'CONFIRMED'`. -> `PERMISSION_DENIED`
8. **Payload 8 (Immutable Field Tampering)**: Owner attempting to change `price` or `orderId` during an update. -> `PERMISSION_DENIED`
9. **Payload 9 (Cross-User PII Read on Bookings)**: User A attempting to `get` User B's booking document containing email and phone. -> `PERMISSION_DENIED`
10. **Payload 10 (Unconstrained List Scraping)**: Non-admin User A running an unfiltered `list` query across `/bookings`. -> `PERMISSION_DENIED`
11. **Payload 11 (Admin Email Spoof Without Verification)**: Attacker with unverified admin email `rameshreddymusku18@gmail.com` (`email_verified: false`) attempting admin read. -> `PERMISSION_DENIED`
12. **Payload 12 (Oversized Message DoW Attack)**: `ContactInquiry` with a 5,000-character `message` exceeding `maxLength: 1000`. -> `PERMISSION_DENIED`
