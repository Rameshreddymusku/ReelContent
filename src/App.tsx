/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Globe,
  Home,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  QrCode,
  ShieldCheck,
  Sparkles,
  Ticket,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import {
  auth,
  db,
  getAccessToken,
  googleSignIn,
  handleFirestoreError,
  initAuth,
  logout,
  OperationType,
  sendConfirmationEmailViaGmail,
} from './firebase';
import { PWAInstallButton, OfflineIndicator } from './PWAComponents';
import {
  BookingRecord,
  ContactInquiryRecord,
  DAILY_TIME_SLOTS,
  detectUserRegion,
  formatBadgeParts,
  formatShortDateHeader,
  getOct2026DayStatus,
  INITIAL_SAMPLE_BOOKINGS,
  REGION_OPTIONS,
  RegionVisitRecord,
  STUDIO_PACKAGES,
  StudioPackage,
  TimeSlot,
} from './data';

type ActiveTab = 'home' | 'bookings' | 'contact' | 'admin';

export default function App() {
  // Auth & OAuth Token state
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

  // User Region state (auto-detected + selectable so Studio Admin sees user's region)
  const detectedInfo = useMemo(() => detectUserRegion(), []);
  const [userRegion, setUserRegion] = useState<string>(detectedInfo.region);
  const [userTimezone] = useState<string>(detectedInfo.timezone);
  const [userLanguage] = useState<string>(detectedInfo.language);

  // Navigation & UI state
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [selectedDay, setSelectedDay] = useState<number>(24); // Matches Oct 24 in screenshot
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<StudioPackage>(STUDIO_PACKAGES[0]);

  // Booking Customer Form
  const [customerName, setCustomerName] = useState<string>('Ramesh Reddy Musku');
  const [customerEmail, setCustomerEmail] = useState<string>('rameshreddymusku18@gmail.com');
  const [customerPhone, setCustomerPhone] = useState<string>('+91 98480 21204');
  const [showBookingDrawer, setShowBookingDrawer] = useState<boolean>(false);
  const [isSubmittingBooking, setIsSubmittingBooking] = useState<boolean>(false);

  // Confirmation Order & Ticket Modal + WhatsApp Modal + Gmail Explicit Confirmation Modal
  const [activeOrderTicket, setActiveOrderTicket] = useState<BookingRecord | null>(null);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState<boolean>(false);
  const [pendingGmailBooking, setPendingGmailBooking] = useState<BookingRecord | null>(null);
  const [gmailSendStatus, setGmailSendStatus] = useState<{
    type: 'idle' | 'sending' | 'success' | 'error';
    message?: string;
  }>({ type: 'idle' });

  // Contact Form state
  const [contactName, setContactName] = useState<string>('');
  const [contactEmail, setContactEmail] = useState<string>('');
  const [contactMessage, setContactMessage] = useState<string>('');
  const [contactStatus, setContactStatus] = useState<string | null>(null);

  // Admin Region Filter
  const [adminRegionFilter, setAdminRegionFilter] = useState<string>('ALL');

  // Firestore & Local Combined State
  const [firestoreBookings, setFirestoreBookings] = useState<BookingRecord[]>([]);
  const [localBookings, setLocalBookings] = useState<BookingRecord[]>(INITIAL_SAMPLE_BOOKINGS);
  const [inquiries, setInquiries] = useState<ContactInquiryRecord[]>([]);
  const [regionVisits, setRegionVisits] = useState<RegionVisitRecord[]>([
    {
      id: 'visit-india',
      userId: 'studio-member-ramesh',
      userEmail: 'rameshreddymusku18@gmail.com',
      region: 'South Asia · India (Hyderabad / Mumbai)',
      timezone: 'Asia/Kolkata',
      language: 'en-IN',
    },
    {
      id: 'visit-us-west',
      userId: 'creator-maya-la',
      userEmail: 'maya@velvetreels.co',
      region: 'North America · US West (Los Angeles / SF)',
      timezone: 'America/Los_Angeles',
      language: 'en-US',
    },
    {
      id: 'visit-uk',
      userId: 'creator-liam-uk',
      userEmail: 'liam@sohostudio.uk',
      region: 'Europe · UK & Ireland (London)',
      timezone: 'Europe/London',
      language: 'en-GB',
    },
  ]);

  const isStudioAdmin =
    !user || user.email === 'rameshreddymusku18@gmail.com';

  // Initialize Auth Listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (loggedInUser, token) => {
        setUser(loggedInUser);
        setAccessToken(token);
        if (loggedInUser.displayName) setCustomerName(loggedInUser.displayName);
        if (loggedInUser.email) setCustomerEmail(loggedInUser.email);
        setAuthReady(true);
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setAuthReady(true);
      }
    );
    return () => unsubscribe();
  }, []);

  // Record user's regional check-in to Firestore when signed in
  useEffect(() => {
    if (!authReady || !user) return;

    const visitDocRef = doc(db, 'region_visits', user.uid);
    const payload = {
      userId: user.uid,
      userEmail: (user.email || 'guest@studio04.app').slice(0, 120),
      region: userRegion.slice(0, 80),
      timezone: userTimezone.slice(0, 60),
      language: userLanguage.slice(0, 20),
      updatedAt: serverTimestamp(),
    };

    setDoc(visitDocRef, payload).catch((err) => {
      try {
        handleFirestoreError(err, OperationType.WRITE, `region_visits/${user.uid}`);
      } catch {
        // Handled and logged by handleFirestoreError
      }
    });
  }, [authReady, user, userRegion, userTimezone, userLanguage]);

  // Real-time Firestore listeners once authenticated
  useEffect(() => {
    if (!authReady || !user) {
      setFirestoreBookings([]);
      return;
    }

    const bookingsPath = 'bookings';
    const bookingsQuery = isStudioAdmin
      ? query(collection(db, bookingsPath), orderBy('createdAt', 'desc'))
      : query(collection(db, bookingsPath), where('userId', '==', user.uid));

    const unsubBookings = onSnapshot(
      bookingsQuery,
      (snapshot) => {
        const items: BookingRecord[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<BookingRecord, 'id'>),
        }));
        setFirestoreBookings(items);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, bookingsPath);
        } catch {
          // Logged structured FirestoreErrorInfo
        }
      }
    );

    let unsubVisits: (() => void) | undefined;
    let unsubInquiries: (() => void) | undefined;

    if (isStudioAdmin) {
      unsubVisits = onSnapshot(
        collection(db, 'region_visits'),
        (snapshot) => {
          const visits: RegionVisitRecord[] = snapshot.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<RegionVisitRecord, 'id'>),
          }));
          if (visits.length > 0) {
            setRegionVisits((prev) => {
              const merged = [...visits];
              prev.forEach((sample) => {
                if (!merged.some((m) => m.id === sample.id)) {
                  merged.push(sample);
                }
              });
              return merged;
            });
          }
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.LIST, 'region_visits');
          } catch {
            // Logged structured FirestoreErrorInfo
          }
        }
      );

      unsubInquiries = onSnapshot(
        collection(db, 'inquiries'),
        (snapshot) => {
          const list: ContactInquiryRecord[] = snapshot.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ContactInquiryRecord, 'id'>),
          }));
          setInquiries(list);
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.LIST, 'inquiries');
          } catch {
            // Logged structured FirestoreErrorInfo
          }
        }
      );
    }

    return () => {
      unsubBookings();
      if (unsubVisits) unsubVisits();
      if (unsubInquiries) unsubInquiries();
    };
  }, [authReady, user, isStudioAdmin]);

  // Combine Firestore bookings and initial sample bookings without duplicates
  const allBookings = useMemo(() => {
    const map = new Map<string, BookingRecord>();
    firestoreBookings.forEach((b) => map.set(b.id, b));
    localBookings.forEach((b) => {
      if (!map.has(b.id)) map.set(b.id, b);
    });
    return Array.from(map.values());
  }, [firestoreBookings, localBookings]);

  const confirmedBookingsCount = useMemo(
    () => allBookings.filter((b) => b.status === 'CONFIRMED').length,
    [allBookings]
  );

  // Latest active booking for the Home Screen quick buttons (WhatsApp & Order/Ticket)
  const latestBooking = useMemo(
    () => allBookings.find((b) => b.status === 'CONFIRMED') || allBookings[0] || INITIAL_SAMPLE_BOOKINGS[0],
    [allBookings]
  );

  const selectedDateStr = `2026-10-${String(selectedDay).padStart(2, '0')}`;

  // Calculate which slots on selectedDateStr are booked
  const daySlotsWithStatus = useMemo(() => {
    return DAILY_TIME_SLOTS.map((slot) => {
      const bookedByUser = allBookings.some(
        (b) =>
          b.dateStr === selectedDateStr &&
          b.slotTime === `${slot.startTime} - ${slot.endTime}` &&
          b.status === 'CONFIRMED'
      );
      // On Oct 24, keep the exact 3 booked slots from the screenshot (09:00, 13:30, 15:00)
      const isDefaultBookedOnOct24 = selectedDay === 24 && slot.defaultBooked;
      const isClosedDay = selectedDay < 24 || selectedDay === 25;
      const isBooked = isClosedDay || isDefaultBookedOnOct24 || bookedByUser;
      return {
        ...slot,
        isBooked,
      };
    });
  }, [allBookings, selectedDateStr, selectedDay]);

  const openSlotsCount = useMemo(
    () => daySlotsWithStatus.filter((s) => !s.isBooked).length,
    [daySlotsWithStatus]
  );

  const selectedSlotObj: TimeSlot | undefined = useMemo(
    () => daySlotsWithStatus.find((s) => s.id === selectedSlotId && !s.isBooked),
    [daySlotsWithStatus, selectedSlotId]
  );

  // Regional analytics for Studio Admin
  const regionalAnalytics = useMemo(() => {
    const counts = new Map<
      string,
      { region: string; bookings: number; revenue: number; visitors: number; lastTimezone: string }
    >();

    // Seed from regionVisits
    regionVisits.forEach((v) => {
      const existing = counts.get(v.region) || {
        region: v.region,
        bookings: 0,
        revenue: 0,
        visitors: 0,
        lastTimezone: v.timezone,
      };
      existing.visitors += 1;
      counts.set(v.region, existing);
    });

    // Ensure current user's selected region is always reflected
    if (!counts.has(userRegion)) {
      counts.set(userRegion, {
        region: userRegion,
        bookings: 0,
        revenue: 0,
        visitors: 1,
        lastTimezone: userTimezone,
      });
    }

    // Aggregate bookings by region
    allBookings.forEach((b) => {
      const entry = counts.get(b.region) || {
        region: b.region,
        bookings: 0,
        revenue: 0,
        visitors: 1,
        lastTimezone: b.timezone,
      };
      entry.bookings += 1;
      if (b.status === 'CONFIRMED') {
        entry.revenue += b.price;
      }
      counts.set(b.region, entry);
    });

    return Array.from(counts.values()).sort((a, b) => b.bookings - a.bookings || b.visitors - a.visitors);
  }, [allBookings, regionVisits, userRegion, userTimezone]);

  const filteredAdminBookings = useMemo(() => {
    if (adminRegionFilter === 'ALL') return allBookings;
    return allBookings.filter((b) => b.region === adminRegionFilter);
  }, [allBookings, adminRegionFilter]);

  // Handlers
  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    try {
      const result = await googleSignIn();
      setUser(result.user);
      setAccessToken(result.accessToken);
      if (result.user.displayName) setCustomerName(result.user.displayName);
      if (result.user.email) setCustomerEmail(result.user.email);
    } catch (err) {
      console.error('Google Sign-In failed:', err);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlotObj) return;

    setIsSubmittingBooking(true);
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderId = `ORD-2026-${randomSuffix}`;
    const ticketId = `TKT-S04-${selectedDay}${randomSuffix.toString().slice(0, 2)}`;
    const bookingId = `bk-${selectedDateStr}-${selectedSlotObj.startTime.replace(':', '')}-${randomSuffix}`;
    const slotTimeRange = `${selectedSlotObj.startTime} - ${selectedSlotObj.endTime}`;

    const newBooking: BookingRecord = {
      id: bookingId,
      orderId,
      ticketId,
      userId: user ? user.uid : 'guest-studio-user',
      customerName: customerName.trim().slice(0, 80) || 'Studio Creator',
      customerEmail: customerEmail.trim().slice(0, 120) || 'rameshreddymusku18@gmail.com',
      customerPhone: customerPhone.trim().slice(0, 30) || '+91 98480 21204',
      region: userRegion.slice(0, 80),
      timezone: userTimezone.slice(0, 60),
      dateStr: selectedDateStr,
      slotTime: slotTimeRange,
      packageName: selectedPackage.name,
      price: selectedPackage.price,
      status: 'CONFIRMED',
      gmailSent: false,
    };

    try {
      if (user) {
        await setDoc(doc(db, 'bookings', bookingId), {
          orderId: newBooking.orderId,
          ticketId: newBooking.ticketId,
          userId: user.uid,
          customerName: newBooking.customerName,
          customerEmail: newBooking.customerEmail,
          customerPhone: newBooking.customerPhone,
          region: newBooking.region,
          timezone: newBooking.timezone,
          dateStr: newBooking.dateStr,
          slotTime: newBooking.slotTime,
          packageName: newBooking.packageName,
          price: newBooking.price,
          status: 'CONFIRMED',
          gmailSent: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setLocalBookings((prev) => [newBooking, ...prev]);
      setShowBookingDrawer(false);
      setSelectedSlotId(null);
      setActiveOrderTicket(newBooking);
    } catch (error) {
      // Fallback to local state if offline or unverified, while still logging structured error
      setLocalBookings((prev) => [newBooking, ...prev]);
      setShowBookingDrawer(false);
      setSelectedSlotId(null);
      setActiveOrderTicket(newBooking);
      try {
        handleFirestoreError(error, OperationType.CREATE, `bookings/${bookingId}`);
      } catch {
        // Logged structured error
      }
    } finally {
      setIsSubmittingBooking(false);
    }
  };

  const handleCancelBooking = async (booking: BookingRecord) => {
    setLocalBookings((prev) =>
      prev.map((b) => (b.id === booking.id ? { ...b, status: 'CANCELLED' } : b))
    );
    if (activeOrderTicket?.id === booking.id) {
      setActiveOrderTicket({ ...booking, status: 'CANCELLED' });
    }
    if (user && firestoreBookings.some((b) => b.id === booking.id)) {
      try {
        await updateDoc(doc(db, 'bookings', booking.id), {
          status: 'CANCELLED',
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        try {
          handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
        } catch {
          // Logged
        }
      }
    }
  };

  // Explicit user-confirmed Gmail API send handler (Mandatory Workspace Integration pattern)
  const executeConfirmedGmailSend = async () => {
    if (!pendingGmailBooking) return;
    setGmailSendStatus({ type: 'sending', message: 'Sending Confirmation Order & Ticket to Gmail...' });

    try {
      let token = await getAccessToken();
      if (!token) {
        const signInResult = await googleSignIn();
        token = signInResult.accessToken;
        setUser(signInResult.user);
        setAccessToken(token);
      }

      await sendConfirmationEmailViaGmail(token, {
        toEmail: pendingGmailBooking.customerEmail,
        customerName: pendingGmailBooking.customerName,
        orderId: pendingGmailBooking.orderId,
        ticketId: pendingGmailBooking.ticketId,
        dateLabel: formatShortDateHeader(pendingGmailBooking.dateStr),
        slotTime: pendingGmailBooking.slotTime,
        packageName: pendingGmailBooking.packageName,
        price: pendingGmailBooking.price,
        region: pendingGmailBooking.region,
      });

      // Mark gmailSent = true in local and Firestore state
      setLocalBookings((prev) =>
        prev.map((b) => (b.id === pendingGmailBooking.id ? { ...b, gmailSent: true } : b))
      );
      if (activeOrderTicket?.id === pendingGmailBooking.id) {
        setActiveOrderTicket({ ...pendingGmailBooking, gmailSent: true });
      }

      if (user && firestoreBookings.some((b) => b.id === pendingGmailBooking.id)) {
        await updateDoc(doc(db, 'bookings', pendingGmailBooking.id), {
          gmailSent: true,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      setGmailSendStatus({
        type: 'success',
        message: `Confirmation Order ${pendingGmailBooking.orderId} & Ticket ${pendingGmailBooking.ticketId} delivered to ${pendingGmailBooking.customerEmail} via Gmail!`,
      });
      setTimeout(() => {
        setPendingGmailBooking(null);
        setGmailSendStatus({ type: 'idle' });
      }, 2200);
    } catch (err) {
      setGmailSendStatus({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Could not send Gmail confirmation. Please sign in with Google and try again.',
      });
    }
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName.trim() || !contactEmail.trim() || !contactMessage.trim()) return;

    const inquiryId = `inq-${Date.now()}`;
    const newInq: ContactInquiryRecord = {
      id: inquiryId,
      userId: user ? user.uid : 'guest',
      name: contactName.trim().slice(0, 80),
      email: contactEmail.trim().slice(0, 120),
      message: contactMessage.trim().slice(0, 1000),
      region: userRegion.slice(0, 80),
    };

    setInquiries((prev) => [newInq, ...prev]);
    setContactName('');
    setContactEmail('');
    setContactMessage('');
    setContactStatus('Message received by Studio 04 · Region tagged: ' + userRegion);

    if (user) {
      try {
        await setDoc(doc(db, 'inquiries', inquiryId), {
          userId: user.uid,
          name: newInq.name,
          email: newInq.email,
          message: newInq.message,
          region: newInq.region,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.CREATE, `inquiries/${inquiryId}`);
        } catch {
          // Logged
        }
      }
    }
  };

  const buildWhatsAppUrl = (booking: BookingRecord) => {
    const text = [
      `*STUDIO 04 · REEL SHOOTS CONFIRMATION ORDER*`,
      `Order ID: ${booking.orderId}`,
      `Ticket Pass: ${booking.ticketId}`,
      `Creator: ${booking.customerName}`,
      `Date: ${formatShortDateHeader(booking.dateStr)}`,
      `Slot: ${booking.slotTime} (90 min)`,
      `Package: ${booking.packageName} ($${booking.price})`,
      `Origin Region: ${booking.region}`,
      `Location: 212 Mercer Lane, Unit 4`,
      `Status: ${booking.status}`,
    ].join('\n');
    return `https://wa.me/12125550104?text=${encodeURIComponent(text)}`;
  };

  return (
    <div className="min-h-screen bg-[#ECE8E0] text-[#161513] flex flex-col">
      <OfflineIndicator />

      {/* Top Desktop Studio Bar (3-Zone Contract on Desktop) */}
      <header className="hidden lg:flex items-center justify-between gap-8 px-8 py-3.5 bg-[#F5F3EE] border-b border-[#E2DDD3]">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('home');
          }}
          className="text-base font-extrabold tracking-tight text-[#161513] whitespace-nowrap shrink-0"
        >
          STUDIO 04 · REEL SHOOTS
        </a>

        <nav className="flex items-center gap-6 text-xs font-mono font-medium text-[#57534E]">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className={`hover:text-[#161513] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'home' ? 'text-[#161513] underline underline-offset-4' : ''
            }`}
          >
            Shoot Calendar
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bookings')}
            className={`hover:text-[#161513] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'bookings' ? 'text-[#161513] underline underline-offset-4' : ''
            }`}
          >
            Bookings ({confirmedBookingsCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveOrderTicket(latestBooking)}
            className="hover:text-[#161513] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Confirmation Ticket
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('contact')}
            className={`hover:text-[#161513] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'contact' ? 'text-[#161513] underline underline-offset-4' : ''
            }`}
          >
            Contact Studio
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('admin')}
            className={`hover:text-[#161513] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'admin' ? 'text-[#E04826] font-bold underline underline-offset-4' : ''
            }`}
          >
            Studio Admin
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <PWAInstallButton />
          {!user ? (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSigningIn}
              className="gsi-material-button"
            >
              <div className="gsi-material-button-state"></div>
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    style={{ display: 'block' }}
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    ></path>
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    ></path>
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    ></path>
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    ></path>
                    <path fill="none" d="M0 0h48v48H0z"></path>
                  </svg>
                </div>
                <span className="gsi-material-button-contents">
                  {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
                </span>
              </div>
            </button>
          ) : (
            <button
              type="button"
              onClick={logout}
              className="px-3.5 py-2 text-xs font-mono font-medium text-[#161513] bg-white border border-[#DCD7CD] rounded-full hover:bg-[#EAE5DC] transition-colors whitespace-nowrap shrink-0"
              title="Click to sign out"
            >
              {user.email} · Sign out
            </button>
          )}
        </div>
      </header>

      {/* Main Responsive Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto lg:py-8 lg:px-8 flex flex-col lg:flex-row items-start justify-center gap-8">
        {/* LEFT / CENTER: Mobile Studio 04 PWA Frame (Exact Screenshot Match) */}
        <div className="w-full lg:w-[420px] shrink-0 mx-auto bg-[#F5F3EE] min-h-screen lg:min-h-[840px] lg:rounded-[48px] lg:border-[10px] lg:border-[#161513] lg:shadow-2xl flex flex-col justify-between relative overflow-hidden">
          {/* Simulated Mobile Status Bar on Desktop Frame */}
          <div className="hidden lg:flex items-center justify-between px-7 pt-3 pb-2 text-[#161513] select-none">
            <span className="font-mono text-[13px] font-bold tracking-tight">9:41</span>
            <div className="w-28 h-6 bg-[#161513] rounded-full" />
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#161513]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#161513]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#161513]" />
              </div>
              <span className="font-mono text-[13px] font-bold">100</span>
            </div>
          </div>

          {/* Mobile Top PWA Install & Google Sign-In Strip (visible on mobile screens) */}
          <div className="flex lg:hidden items-center justify-between px-5 pt-3 pb-1 gap-2">
            <PWAInstallButton />
            {!user && (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSigningIn}
                className="gsi-material-button"
              >
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg viewBox="0 0 48 48" style={{ display: 'block' }}>
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">Sign in</span>
                </div>
              </button>
            )}
          </div>

          {/* Scrollable Tab Body */}
          <div className="flex-1 overflow-y-auto px-5 pt-4 pb-28">
            {/* ==================== TAB 1: HOME SCREEN ==================== */}
            {activeTab === 'home' && (
              <div>
                {/* Header matching Screenshot 1 */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="font-mono text-[11px] tracking-[0.16em] text-[#6E6A63] uppercase mb-1">
                      STUDIO 04 · REEL SHOOTS
                    </div>
                    <h1 className="text-[34px] leading-[1.05] font-extrabold tracking-tight text-[#161513]">
                      Pick your
                      <br />
                      shoot slot.
                    </h1>
                  </div>

                  {/* Terracotta 'R' Avatar Circle from Screenshot 1 */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!user) {
                        handleGoogleSignIn();
                      } else {
                        setActiveTab('admin');
                      }
                    }}
                    title={
                      user
                        ? `Signed in as ${user.email} (Tap for Studio Admin)`
                        : 'Sign in with Google'
                    }
                    className="w-12 h-12 rounded-full bg-[#E04826] text-white font-bold text-lg flex items-center justify-center shadow-xs hover:bg-[#c93d1e] transition-colors shrink-0 cursor-pointer"
                  >
                    {customerName ? customerName.charAt(0).toUpperCase() : 'R'}
                  </button>
                </div>

                {/* User Region Strip (So Studio Admin knows which region the user is coming from) */}
                <div className="mb-3.5 rounded-2xl bg-white border border-[#E8E4DC] px-3.5 py-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe className="w-4 h-4 text-[#E04826] shrink-0" />
                    <span className="font-mono text-[11px] text-[#6E6A63] shrink-0">
                      REGION:
                    </span>
                    <select
                      aria-label="Your Origin Region"
                      value={userRegion}
                      onChange={(e) => setUserRegion(e.target.value)}
                      className="font-mono text-[11px] font-semibold text-[#161513] bg-transparent focus:outline-none truncate cursor-pointer"
                    >
                      {REGION_OPTIONS.map((reg) => (
                        <option key={reg} value={reg}>
                          {reg}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('admin')}
                    className="font-mono text-[10px] font-semibold text-[#E04826] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    ADMIN VIEW
                  </button>
                </div>

                {/* TWO MANDATORY HOMESCREEN BUTTONS:
                    1) WhatsApp Confirmation Order
                    2) Confirmation Order & Confirmation Ticket (with Gmail delivery) */}
                <div className="grid grid-cols-2 gap-2.5 mb-5">
                  <button
                    type="button"
                    onClick={() => setShowWhatsAppModal(true)}
                    className="min-h-[46px] rounded-2xl bg-[#181614] text-white px-3.5 py-2.5 flex items-center justify-center gap-2 text-xs font-semibold hover:bg-[#2B2925] transition-colors cursor-pointer"
                  >
                    <MessageCircle className="w-4 h-4 text-[#25D366] shrink-0" />
                    <span className="whitespace-nowrap truncate">WhatsApp Order</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveOrderTicket(latestBooking)}
                    className="min-h-[46px] rounded-2xl bg-[#E04826] text-white px-3.5 py-2.5 flex items-center justify-center gap-2 text-xs font-semibold hover:bg-[#C93D1E] transition-colors cursor-pointer"
                  >
                    <Ticket className="w-4 h-4 text-white shrink-0" />
                    <span className="whitespace-nowrap truncate">Order & Ticket</span>
                  </button>
                </div>

                {/* Calendar Card matching Screenshots 1-3 */}
                <div className="rounded-[28px] bg-white border border-[#E8E4DC] p-5 mb-6">
                  {/* Month Header */}
                  <div className="flex items-center justify-between mb-5">
                    <button
                      type="button"
                      onClick={() => setSelectedDay((d) => (d > 24 ? d - 1 : 24))}
                      aria-label="Previous Day"
                      className="w-10 h-10 rounded-full border border-[#E5E0D5] flex items-center justify-center text-[#161513] hover:bg-[#F5F3EE] transition-colors cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-[17px] font-bold tracking-tight text-[#161513]">
                      October 2026
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedDay((d) => (d < 31 ? d + 1 : 24))}
                      aria-label="Next Day"
                      className="w-10 h-10 rounded-full border border-[#E5E0D5] flex items-center justify-center text-[#161513] hover:bg-[#F5F3EE] transition-colors cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Weekday Row */}
                  <div className="grid grid-cols-7 text-center font-mono text-[11px] text-[#6E6A63] mb-3">
                    <span>MO</span>
                    <span>TU</span>
                    <span>WE</span>
                    <span>TH</span>
                    <span>FR</span>
                    <span>SA</span>
                    <span>SU</span>
                  </div>

                  {/* Calendar Days Grid (Oct 1, 2026 starts on Thursday -> 3 empty slots for MO, TU, WE) */}
                  <div className="grid grid-cols-7 gap-y-2 text-center">
                    <div />
                    <div />
                    <div />
                    {Array.from({ length: 31 }, (_, idx) => {
                      const day = idx + 1;
                      const status = getOct2026DayStatus(day);
                      const isSelected = selectedDay === day;
                      const isInteractive = day >= 24 && day !== 25;

                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            setSelectedDay(day);
                            setSelectedSlotId(null);
                          }}
                          className={`h-12 w-10 mx-auto rounded-2xl flex flex-col items-center justify-center transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-[#161513] text-white font-bold'
                              : isInteractive
                              ? 'text-[#161513] font-bold hover:bg-[#F5F3EE]'
                              : 'text-[#9E9A93] font-medium'
                          }`}
                        >
                          <span className="text-[15px] leading-none">{day}</span>
                          {/* Availability Dot underneath days 24..31 */}
                          {day >= 24 && (
                            <span
                              className={`w-1 h-1 rounded-full mt-1.5 ${
                                isSelected
                                  ? 'bg-white'
                                  : status === 'closed'
                                  ? 'bg-[#D6D2C9]'
                                  : status === 'few'
                                  ? 'bg-[#E04826]'
                                  : 'bg-[#161513]'
                              }`}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Legend at bottom of Calendar Card */}
                  <div className="flex items-center gap-4 mt-5 pt-2 font-mono text-[11px] text-[#6E6A63]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#161513]" />
                      <span>Open</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#E04826]" />
                      <span>Few left</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#C8C4BC]" />
                      <span>Full / closed</span>
                    </div>
                  </div>
                </div>

                {/* Selected Day Header (`Sat, 24 Oct` · `4 of 7 open`) */}
                <div className="flex items-baseline justify-between mb-3.5">
                  <h2 className="text-[22px] font-extrabold tracking-tight text-[#161513]">
                    {formatShortDateHeader(selectedDateStr)}
                  </h2>
                  <span className="font-mono text-xs text-[#57534E]">
                    {openSlotsCount} of {DAILY_TIME_SLOTS.length} open
                  </span>
                </div>

                {/* Time Slots List matching Screenshot 3 & 4 */}
                <div className="space-y-2.5 mb-5">
                  {daySlotsWithStatus.map((slot) => {
                    const isSelected = selectedSlotId === slot.id;
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        disabled={slot.isBooked}
                        onClick={() => setSelectedSlotId(slot.id)}
                        className={`w-full rounded-[22px] px-5 py-4 flex items-center justify-between border transition-all text-left ${
                          slot.isBooked
                            ? 'bg-[#F5F3EE] border-[#E5E0D5] opacity-75 cursor-not-allowed'
                            : isSelected
                            ? 'bg-[#161513] text-white border-[#161513] shadow-md cursor-pointer'
                            : 'bg-white border-[#E8E4DC] hover:border-[#161513] cursor-pointer'
                        }`}
                      >
                        <div className="flex items-baseline gap-2.5 font-mono">
                          <span
                            className={`text-[20px] font-semibold tracking-tight ${
                              slot.isBooked
                                ? 'line-through text-[#9E9A93]'
                                : isSelected
                                ? 'text-white'
                                : 'text-[#161513]'
                            }`}
                          >
                            {slot.startTime}
                          </span>
                          <span
                            className={`text-xs ${
                              slot.isBooked
                                ? 'text-[#A8A49C]'
                                : isSelected
                                ? 'text-[#D6D2C9]'
                                : 'text-[#6E6A63]'
                            }`}
                          >
                            → {slot.endTime} · {slot.durationMin} min
                          </span>
                        </div>

                        <span
                          className={`font-mono text-[11px] font-semibold px-3 py-1 rounded-full ${
                            slot.isBooked
                              ? 'bg-[#EAE5DC] text-[#8C8881]'
                              : isSelected
                              ? 'bg-[#E04826] text-white'
                              : 'bg-[#F5F3EE] text-[#161513]'
                          }`}
                        >
                          {slot.isBooked ? 'BOOKED' : isSelected ? 'SELECTED' : 'OPEN'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Primary Bottom Slot Action Bar matching Screenshot 2 & 4 */}
                <div className="pt-2 border-t border-[#E5E0D5]">
                  <button
                    type="button"
                    disabled={!selectedSlotObj}
                    onClick={() => setShowBookingDrawer(true)}
                    className={`w-full h-14 rounded-full pl-6 pr-2 flex items-center justify-between transition-all ${
                      selectedSlotObj
                        ? 'bg-[#161513] text-white cursor-pointer shadow-md'
                        : 'bg-[#D6D2C9] text-[#78746D] cursor-not-allowed'
                    }`}
                  >
                    <span className="text-[15px] font-semibold tracking-tight">
                      {selectedSlotObj
                        ? `Book ${selectedSlotObj.startTime} – ${selectedSlotObj.endTime} · $${selectedPackage.price}`
                        : 'Select a time slot'}
                    </span>
                    <span
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        selectedSlotObj ? 'bg-[#E04826] text-white' : 'bg-[#DFDCD4] text-[#78746D]'
                      }`}
                    >
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* ==================== TAB 2: BOOKINGS SCREEN ==================== */}
            {activeTab === 'bookings' && (
              <div>
                <div className="font-mono text-[11px] tracking-[0.16em] text-[#6E6A63] uppercase mb-1">
                  YOUR SCHEDULE
                </div>
                <h1 className="text-[34px] font-extrabold tracking-tight text-[#161513] mb-5">
                  Bookings
                </h1>

                <div className="space-y-3.5">
                  {allBookings.map((booking) => {
                    const badge = formatBadgeParts(booking.dateStr);
                    return (
                      <div
                        key={booking.id}
                        className="rounded-[26px] bg-white border border-[#E8E4DC] p-4 shadow-2xs"
                      >
                        <div className="flex items-center gap-4">
                          {/* Iconic Black Rounded Date Badge from Screenshot 5 */}
                          <div className="w-16 h-20 rounded-2xl bg-[#161513] text-white flex flex-col items-center justify-center shrink-0">
                            <span className="font-mono text-[10px] font-bold text-[#E04826] tracking-wider">
                              {badge.month}
                            </span>
                            <span className="text-[24px] font-extrabold leading-tight">
                              {badge.day}
                            </span>
                            <span className="font-mono text-[10px] text-[#A09C94]">
                              {badge.weekday}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-[17px] font-bold text-[#161513]">
                              {booking.slotTime}
                            </div>
                            <div className="text-[13px] text-[#6E6A63] mt-0.5">
                              {booking.packageName} · ${booking.price}
                            </div>
                            <div className="font-mono text-[10px] text-[#6E6A63] mt-0.5 truncate">
                              Region: {booking.region}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 mt-2.5">
                              <span
                                className={`font-mono text-[10px] font-bold px-3 py-1 rounded-full ${
                                  booking.status === 'CONFIRMED'
                                    ? 'bg-[#DFF0D8] text-[#2B542C]'
                                    : 'bg-[#F2DEDE] text-[#A94442]'
                                }`}
                              >
                                {booking.status}
                              </span>

                              {booking.status === 'CONFIRMED' && (
                                <button
                                  type="button"
                                  onClick={() => handleCancelBooking(booking)}
                                  className="font-mono text-[10px] font-semibold px-3 py-1 rounded-full border border-[#DCD7CD] text-[#161513] hover:bg-[#F5F3EE] transition-colors cursor-pointer"
                                >
                                  CANCEL
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Quick Order, Ticket, Gmail, and WhatsApp Actions */}
                        <div className="mt-3.5 pt-3 border-t border-[#F0ECE3] flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveOrderTicket(booking)}
                            className="flex-1 h-9 rounded-xl bg-[#F5F3EE] hover:bg-[#EAE5DC] text-[#161513] font-mono text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Ticket className="w-3.5 h-3.5 text-[#E04826]" />
                            <span>ORDER & TICKET</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setPendingGmailBooking(booking)}
                            className="flex-1 h-9 rounded-xl bg-[#161513] hover:bg-[#2B2925] text-white font-mono text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Mail className="w-3.5 h-3.5 text-[#E04826]" />
                            <span>{booking.gmailSent ? 'RESEND GMAIL' : 'SEND GMAIL'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ==================== TAB 3: CONTACT SCREEN ==================== */}
            {activeTab === 'contact' && (
              <div>
                <h1 className="text-[34px] font-extrabold tracking-tight text-[#161513] mb-5">
                  Contact
                </h1>

                {/* Dark Studio 04 Card matching Screenshot 7 */}
                <div className="rounded-[28px] bg-[#181614] text-white p-5 mb-5">
                  <h2 className="text-[20px] font-bold text-white mb-1">Studio 04</h2>
                  <p className="text-[13px] text-[#A8A49C]">212 Mercer Lane, Unit 4</p>
                  <p className="text-[13px] text-[#A8A49C] mb-5">Mon–Sat · 09:00–20:00</p>

                  <div className="grid grid-cols-3 gap-2.5">
                    <a
                      href="tel:+12125550104"
                      className="h-20 rounded-2xl bg-[#E04826] hover:bg-[#C93D1E] text-white flex flex-col items-center justify-center gap-1.5 transition-colors"
                    >
                      <Phone className="w-5 h-5" />
                      <span className="text-xs font-bold">Call</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => setShowWhatsAppModal(true)}
                      className="h-20 rounded-2xl bg-[#262421] hover:bg-[#33302C] text-white flex flex-col items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <MessageCircle className="w-5 h-5" />
                      <span className="text-xs font-bold">WhatsApp</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPendingGmailBooking(latestBooking)}
                      className="h-20 rounded-2xl bg-[#262421] hover:bg-[#33302C] text-white flex flex-col items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Mail className="w-5 h-5" />
                      <span className="text-xs font-bold">Email</span>
                    </button>
                  </div>
                </div>

                {/* Send a Message Card matching Screenshot 7 */}
                <form
                  onSubmit={handleContactSubmit}
                  className="rounded-[28px] bg-white border border-[#E8E4DC] p-5"
                >
                  <h3 className="text-[18px] font-bold text-[#161513] mb-4">Send a message</h3>

                  <div className="mb-3.5">
                    <label className="block font-mono text-[11px] text-[#6E6A63] uppercase mb-1.5">
                      NAME
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder="Your name"
                      className="w-full h-12 rounded-2xl bg-[#F5F3EE] border border-[#E5E0D5] px-4 font-mono text-xs text-[#161513] placeholder:text-[#8C8881] focus:outline-none focus:border-[#161513]"
                    />
                  </div>

                  <div className="mb-3.5">
                    <label className="block font-mono text-[11px] text-[#6E6A63] uppercase mb-1.5">
                      EMAIL
                    </label>
                    <input
                      type="email"
                      required
                      maxLength={120}
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      placeholder="you@brand.com"
                      className="w-full h-12 rounded-2xl bg-[#F5F3EE] border border-[#E5E0D5] px-4 font-mono text-xs text-[#161513] placeholder:text-[#8C8881] focus:outline-none focus:border-[#161513]"
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block font-mono text-[11px] text-[#6E6A63] uppercase mb-1.5">
                      MESSAGE
                    </label>
                    <textarea
                      required
                      maxLength={1000}
                      rows={3}
                      value={contactMessage}
                      onChange={(e) => setContactMessage(e.target.value)}
                      placeholder="What kind of reels are you planning?"
                      className="w-full rounded-2xl bg-[#F5F3EE] border border-[#E5E0D5] p-4 font-mono text-xs text-[#161513] placeholder:text-[#8C8881] focus:outline-none focus:border-[#161513]"
                    />
                  </div>

                  {contactStatus && (
                    <div className="mb-3 rounded-xl bg-[#DFF0D8] text-[#2B542C] px-3 py-2 font-mono text-[11px]">
                      {contactStatus}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full h-13 rounded-full bg-[#161513] hover:bg-[#2B2925] text-white font-semibold text-sm transition-colors cursor-pointer"
                  >
                    Send message
                  </button>
                </form>
              </div>
            )}

            {/* ==================== TAB 4: STUDIO ADMIN REGIONAL DASHBOARD ==================== */}
            {activeTab === 'admin' && (
              <div>
                <div className="font-mono text-[11px] tracking-[0.16em] text-[#E04826] uppercase mb-1">
                  STUDIO 04 ADMIN · REGIONAL TELEMETRY
                </div>
                <h1 className="text-[28px] font-extrabold tracking-tight text-[#161513] mb-4">
                  User Origin Regions
                </h1>

                <div className="rounded-3xl bg-[#181614] text-white p-4 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[11px] text-[#A8A49C]">
                      ACTIVE VISITOR REGION
                    </span>
                    <span className="font-mono text-[10px] text-[#E04826] font-bold">
                      LIVE DETECTED
                    </span>
                  </div>
                  <div className="text-sm font-bold text-white mb-1">{userRegion}</div>
                  <div className="font-mono text-[11px] text-[#A8A49C]">
                    Timezone: {userTimezone} · Locale: {userLanguage}
                  </div>
                </div>

                {/* Regional Distribution Breakdown */}
                <div className="rounded-3xl bg-white border border-[#E8E4DC] p-4 mb-4">
                  <div className="font-mono text-[11px] font-bold text-[#161513] uppercase mb-3">
                    Bookings & Traffic by Region
                  </div>
                  <div className="space-y-3">
                    {regionalAnalytics.map((item) => (
                      <div
                        key={item.region}
                        className="p-3 rounded-2xl bg-[#F5F3EE] border border-[#E5E0D5]"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs font-bold text-[#161513] truncate">
                            {item.region}
                          </span>
                          <span className="font-mono text-xs font-bold text-[#E04826] shrink-0">
                            ${item.revenue}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-[#6E6A63] flex items-center justify-between">
                          <span>
                            {item.bookings} booking(s) · {item.visitors} visitor(s)
                          </span>
                          <span>{item.lastTimezone}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* All Regional Orders List */}
                <div className="rounded-3xl bg-white border border-[#E8E4DC] p-4">
                  <div className="font-mono text-[11px] font-bold text-[#161513] uppercase mb-3">
                    Confirmation Orders & User Regions
                  </div>
                  <div className="space-y-2.5">
                    {allBookings.map((b) => (
                      <div
                        key={b.id}
                        className="p-3 rounded-2xl bg-[#F5F3EE] border border-[#E5E0D5]"
                      >
                        <div className="flex items-center justify-between font-mono text-[11px] font-bold text-[#161513]">
                          <span>{b.orderId}</span>
                          <span className="text-[#E04826]">{b.ticketId}</span>
                        </div>
                        <div className="text-xs font-semibold text-[#161513] mt-1">
                          {b.customerName} ({b.customerEmail})
                        </div>
                        <div className="font-mono text-[10px] text-[#161513] bg-white px-2.5 py-1 rounded-lg border border-[#E5E0D5] mt-1.5">
                          From Region: <strong>{b.region}</strong> ({b.timezone})
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Fixed Bottom Navigation Bar inside the Mobile Frame (Matching Screenshots 2, 4, 6) */}
          <nav
            aria-label="Primary Mobile Navigation"
            className="sticky bottom-0 left-0 right-0 z-30 bg-[#F5F3EE]/95 backdrop-blur-md border-t border-[#E2DDD3] px-3 py-2.5 grid grid-cols-4 items-center"
          >
            <button
              type="button"
              onClick={() => setActiveTab('home')}
              className="flex flex-col items-center justify-center min-h-[48px] cursor-pointer"
            >
              <div
                className={`w-13 h-8 rounded-full flex items-center justify-center transition-colors ${
                  activeTab === 'home' ? 'bg-[#F3DCD4] text-[#161513]' : 'text-[#6E6A63]'
                }`}
              >
                <Home className="w-4 h-4" />
              </div>
              <span
                className={`text-[11px] mt-1 ${
                  activeTab === 'home' ? 'font-bold text-[#161513]' : 'font-medium text-[#6E6A63]'
                }`}
              >
                Home
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('bookings')}
              className="flex flex-col items-center justify-center min-h-[48px] relative cursor-pointer"
            >
              <div
                className={`w-13 h-8 rounded-full flex items-center justify-center relative transition-colors ${
                  activeTab === 'bookings' ? 'bg-[#F3DCD4] text-[#161513]' : 'text-[#6E6A63]'
                }`}
              >
                <CalendarIcon className="w-4 h-4" />
                {confirmedBookingsCount > 0 && (
                  <span className="absolute -top-1 right-1 w-4.5 h-4.5 rounded-full bg-[#E04826] text-white font-mono text-[10px] font-bold flex items-center justify-center">
                    {confirmedBookingsCount}
                  </span>
                )}
              </div>
              <span
                className={`text-[11px] mt-1 ${
                  activeTab === 'bookings'
                    ? 'font-bold text-[#161513]'
                    : 'font-medium text-[#6E6A63]'
                }`}
              >
                Bookings
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('contact')}
              className="flex flex-col items-center justify-center min-h-[48px] cursor-pointer"
            >
              <div
                className={`w-13 h-8 rounded-full flex items-center justify-center transition-colors ${
                  activeTab === 'contact' ? 'bg-[#F3DCD4] text-[#161513]' : 'text-[#6E6A63]'
                }`}
              >
                <Phone className="w-4 h-4" />
              </div>
              <span
                className={`text-[11px] mt-1 ${
                  activeTab === 'contact'
                    ? 'font-bold text-[#161513]'
                    : 'font-medium text-[#6E6A63]'
                }`}
              >
                Contact
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('admin')}
              className="flex flex-col items-center justify-center min-h-[48px] cursor-pointer"
            >
              <div
                className={`w-13 h-8 rounded-full flex items-center justify-center transition-colors ${
                  activeTab === 'admin' ? 'bg-[#F3DCD4] text-[#161513]' : 'text-[#6E6A63]'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
              </div>
              <span
                className={`text-[11px] mt-1 ${
                  activeTab === 'admin' ? 'font-bold text-[#161513]' : 'font-medium text-[#6E6A63]'
                }`}
              >
                Admin
              </span>
            </button>
          </nav>
        </div>

        {/* RIGHT DESKTOP COMPANION: Studio Admin Regional Intelligence & Live Confirmation Ticket Preview */}
        <div className="hidden lg:flex flex-col flex-1 gap-6 w-full">
          {/* Card 1: Studio Admin Regional Intelligence Console */}
          <section className="rounded-[32px] bg-[#F5F3EE] border border-[#DFDBD0] p-7">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <div className="font-mono text-xs tracking-[0.15em] text-[#E04826] font-bold uppercase mb-1">
                  STUDIO 04 ADMIN CONSOLE · REGIONAL ORIGIN TRACKER
                </div>
                <h2 className="text-2xl font-extrabold tracking-tight text-[#161513]">
                  Where Reel Creators Are Booking From
                </h2>
              </div>

              <div className="flex items-center gap-2 font-mono text-xs text-[#57534E]">
                <MapPin className="w-4 h-4 text-[#E04826]" />
                <span>Detected: {userTimezone}</span>
              </div>
            </div>

            {/* Region Filter Tabs */}
            <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-[#EAE5DC] rounded-2xl mb-6">
              <button
                type="button"
                onClick={() => setAdminRegionFilter('ALL')}
                className={`px-3.5 py-1.5 text-xs font-mono font-semibold rounded-xl transition-colors cursor-pointer ${
                  adminRegionFilter === 'ALL'
                    ? 'bg-[#161513] text-white'
                    : 'text-[#57534E] hover:text-[#161513]'
                }`}
              >
                All Regions ({allBookings.length})
              </button>
              {regionalAnalytics.map((reg) => (
                <button
                  key={reg.region}
                  type="button"
                  onClick={() => setAdminRegionFilter(reg.region)}
                  className={`px-3.5 py-1.5 text-xs font-mono font-semibold rounded-xl transition-colors cursor-pointer ${
                    adminRegionFilter === reg.region
                      ? 'bg-[#161513] text-white'
                      : 'text-[#57534E] hover:text-[#161513]'
                  }`}
                >
                  {reg.region.split('·')[0].trim()} ({reg.bookings})
                </button>
              ))}
            </div>

            {/* Regional Summary Grid */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              {regionalAnalytics.slice(0, 3).map((item) => (
                <div
                  key={item.region}
                  className="rounded-2xl bg-white border border-[#E5E0D5] p-4 flex flex-col justify-between"
                >
                  <div className="font-mono text-[11px] text-[#6E6A63] mb-1">{item.lastTimezone}</div>
                  <div className="text-sm font-bold text-[#161513] mb-3">{item.region}</div>
                  <div className="flex items-baseline justify-between pt-2 border-t border-[#F0ECE3] font-mono">
                    <span className="text-xs text-[#57534E]">
                      {item.bookings} order(s) · {item.visitors} user(s)
                    </span>
                    <span className="text-sm font-bold text-[#E04826]">${item.revenue}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Admin Orders Table with User Region Highlight */}
            <div className="rounded-2xl bg-white border border-[#E5E0D5] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#EFECE4] flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#161513]">
                  LIVE CONFIRMATION ORDERS & TICKETS
                </span>
                <span className="font-mono text-xs text-[#6E6A63]">
                  Showing {filteredAdminBookings.length} record(s)
                </span>
              </div>
              <div className="divide-y divide-[#EFECE4]">
                {filteredAdminBookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-[#FAF8F5] transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5 font-mono text-xs">
                        <span className="font-bold text-[#161513]">{booking.orderId}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#E04826] font-bold">{booking.ticketId}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#57534E]">
                          {formatShortDateHeader(booking.dateStr)} ({booking.slotTime})
                        </span>
                      </div>
                      <div className="text-sm font-bold text-[#161513] mt-1">
                        {booking.customerName}{' '}
                        <span className="font-normal text-[#6E6A63]">({booking.customerEmail})</span>
                      </div>
                      <div className="font-mono text-xs text-[#57534E] mt-1 flex items-center gap-2">
                        <Globe className="w-3.5 h-3.5 text-[#E04826]" />
                        <span>
                          User Region: <strong className="text-[#161513]">{booking.region}</strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{booking.timezone}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setActiveOrderTicket(booking)}
                        className="px-3 py-2 rounded-xl bg-[#F5F3EE] hover:bg-[#EAE5DC] text-[#161513] font-mono text-xs font-semibold cursor-pointer"
                      >
                        Ticket
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingGmailBooking(booking)}
                        className="px-3 py-2 rounded-xl bg-[#161513] hover:bg-[#2B2925] text-white font-mono text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Mail className="w-3.5 h-3.5 text-[#E04826]" />
                        <span>{booking.gmailSent ? 'Gmail Sent' : 'Send Gmail'}</span>
                      </button>
                      <a
                        href={buildWhatsAppUrl(booking)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-2 rounded-xl bg-[#25D366]/15 hover:bg-[#25D366]/25 text-[#161513] font-mono text-xs font-semibold flex items-center gap-1.5"
                      >
                        <MessageCircle className="w-3.5 h-3.5 text-[#161513]" />
                        <span>WhatsApp</span>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Card 2: Instant Preview of Active Confirmation Order & Studio Pass Ticket */}
          <section className="rounded-[32px] bg-[#181614] text-white p-7">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-mono text-xs text-[#E04826] tracking-[0.15em] uppercase">
                  ACTIVE CONFIRMATION ORDER & STUDIO TICKET
                </div>
                <h3 className="text-xl font-extrabold text-white mt-0.5">
                  {latestBooking.orderId} · {latestBooking.ticketId}
                </h3>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowWhatsAppModal(true)}
                  className="px-4 py-2.5 rounded-full bg-[#262421] hover:bg-[#33302C] text-white font-mono text-xs font-semibold flex items-center gap-2 cursor-pointer"
                >
                  <MessageCircle className="w-4 h-4 text-[#25D366]" />
                  <span>WhatsApp Order</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPendingGmailBooking(latestBooking)}
                  className="px-4 py-2.5 rounded-full bg-[#E04826] hover:bg-[#C93D1E] text-white font-mono text-xs font-semibold flex items-center gap-2 cursor-pointer"
                >
                  <Mail className="w-4 h-4" />
                  <span>Send Order to Gmail</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 pt-4 border-t border-white/10 font-mono text-xs">
              <div>
                <div className="text-[#8C8881]">SHOOT SLOT</div>
                <div className="font-bold text-white mt-1">
                  {formatShortDateHeader(latestBooking.dateStr)} · {latestBooking.slotTime}
                </div>
              </div>
              <div>
                <div className="text-[#8C8881]">PACKAGE & TOTAL</div>
                <div className="font-bold text-white mt-1">
                  {latestBooking.packageName} · ${latestBooking.price}
                </div>
              </div>
              <div>
                <div className="text-[#8C8881]">USER ORIGIN REGION</div>
                <div className="font-bold text-[#E04826] mt-1">{latestBooking.region}</div>
              </div>
              <div>
                <div className="text-[#8C8881]">GMAIL DELIVERY</div>
                <div className="font-bold text-white mt-1">
                  {latestBooking.gmailSent ? 'Delivered to Gmail' : 'Ready to Send'}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* ==================== MODAL 1: BOOKING CHECKOUT DRAWER ==================== */}
      {showBookingDrawer && selectedSlotObj && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-[32px] sm:rounded-[32px] bg-[#FAF8F5] border border-[#E5E0D5] p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-mono text-[11px] text-[#E04826] font-bold uppercase tracking-wider">
                  STUDIO 04 · SLOT RESERVATION
                </div>
                <h3 className="text-xl font-extrabold text-[#161513]">
                  {formatShortDateHeader(selectedDateStr)} · {selectedSlotObj.startTime} –{' '}
                  {selectedSlotObj.endTime}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowBookingDrawer(false)}
                className="w-9 h-9 rounded-full bg-[#EAE5DC] flex items-center justify-center text-[#161513] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBooking} className="space-y-4">
              {/* Package Selection */}
              <div>
                <label className="block font-mono text-[11px] text-[#6E6A63] uppercase mb-2">
                  SELECT SHOOT PACKAGE
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {STUDIO_PACKAGES.map((pkg) => {
                    const active = selectedPackage.name === pkg.name;
                    return (
                      <button
                        key={pkg.name}
                        type="button"
                        onClick={() => setSelectedPackage(pkg)}
                        className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                          active
                            ? 'bg-[#161513] text-white border-[#161513]'
                            : 'bg-white text-[#161513] border-[#E5E0D5]'
                        }`}
                      >
                        <div className="text-xs font-bold">{pkg.name}</div>
                        <div
                          className={`font-mono text-sm font-extrabold mt-0.5 ${
                            active ? 'text-[#E04826]' : 'text-[#161513]'
                          }`}
                        >
                          ${pkg.price}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Region Confirmation for Studio Admin */}
              <div>
                <label className="block font-mono text-[11px] text-[#6E6A63] uppercase mb-1.5">
                  YOUR REGION (SHARED WITH STUDIO ADMIN)
                </label>
                <select
                  value={userRegion}
                  onChange={(e) => setUserRegion(e.target.value)}
                  className="w-full h-11 rounded-2xl bg-white border border-[#E5E0D5] px-3.5 font-mono text-xs text-[#161513]"
                >
                  {REGION_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-mono text-[11px] text-[#6E6A63] uppercase mb-1.5">
                  CREATOR / BRAND NAME
                </label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full h-11 rounded-2xl bg-white border border-[#E5E0D5] px-3.5 font-mono text-xs text-[#161513]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-[11px] text-[#6E6A63] uppercase mb-1.5">
                    GMAIL FOR CONFIRMATION
                  </label>
                  <input
                    type="email"
                    required
                    maxLength={120}
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="w-full h-11 rounded-2xl bg-white border border-[#E5E0D5] px-3.5 font-mono text-xs text-[#161513]"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[11px] text-[#6E6A63] uppercase mb-1.5">
                    WHATSAPP NUMBER
                  </label>
                  <input
                    type="tel"
                    required
                    maxLength={30}
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full h-11 rounded-2xl bg-white border border-[#E5E0D5] px-3.5 font-mono text-xs text-[#161513]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmittingBooking}
                className="w-full h-13 rounded-full bg-[#161513] hover:bg-[#2B2925] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-[#E04826]" />
                <span>
                  {isSubmittingBooking
                    ? 'Generating Confirmation Order & Ticket...'
                    : `Confirm Order & Generate Ticket · $${selectedPackage.price}`}
                </span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL 2: CONFIRMATION ORDER & CONFIRMATION TICKET ==================== */}
      {activeOrderTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-[32px] bg-[#FAF8F5] border border-[#E5E0D5] p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-[#DFF0D8] text-[#2B542C] flex items-center justify-center">
                  <Check className="w-4 h-4" />
                </span>
                <div>
                  <div className="font-mono text-[10px] text-[#6E6A63] uppercase tracking-wider">
                    STUDIO 04 · VERIFIED BOOKING
                  </div>
                  <h3 className="text-lg font-extrabold text-[#161513]">
                    Confirmation Order & Ticket
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveOrderTicket(null)}
                className="w-9 h-9 rounded-full bg-[#EAE5DC] flex items-center justify-center text-[#161513] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* PART A: CONFIRMATION ORDER CARD */}
            <div className="rounded-2xl bg-white border border-[#E5E0D5] p-4 mb-4">
              <div className="flex items-center justify-between border-b border-[#F0ECE3] pb-2.5 mb-3">
                <span className="font-mono text-[11px] font-bold text-[#E04826]">
                  CONFIRMATION ORDER · {activeOrderTicket.orderId}
                </span>
                <span className="font-mono text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#DFF0D8] text-[#2B542C]">
                  {activeOrderTicket.status}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#6E6A63]">Creator</span>
                  <span className="font-bold text-[#161513]">{activeOrderTicket.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6E6A63]">Gmail Recipient</span>
                  <span className="font-mono text-[#161513]">{activeOrderTicket.customerEmail}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6E6A63]">User Origin Region</span>
                  <span className="font-mono font-semibold text-[#161513]">
                    {activeOrderTicket.region}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6E6A63]">Package & Total</span>
                  <span className="font-mono font-bold text-[#161513]">
                    {activeOrderTicket.packageName} · ${activeOrderTicket.price}.00
                  </span>
                </div>
              </div>
            </div>

            {/* PART B: PERFORATED STUDIO 04 CONFIRMATION TICKET */}
            <div className="rounded-3xl bg-[#161513] text-white p-5 relative overflow-hidden mb-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="font-mono text-[10px] text-[#E04826] font-bold tracking-[0.18em] uppercase">
                    STUDIO 04 · PASS TICKET
                  </div>
                  <div className="font-mono text-xl font-extrabold tracking-tight mt-0.5">
                    {activeOrderTicket.ticketId}
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-white text-[#161513]">
                  <QrCode className="w-10 h-10" />
                </div>
              </div>

              <div className="border-t border-dashed border-white/20 my-3 pt-3 grid grid-cols-2 gap-3 font-mono text-xs">
                <div>
                  <div className="text-[10px] text-[#A09C94]">SHOOT DATE</div>
                  <div className="font-bold text-white">
                    {formatShortDateHeader(activeOrderTicket.dateStr)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#A09C94]">TIME SLOT (90M)</div>
                  <div className="font-bold text-white">{activeOrderTicket.slotTime}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[#A09C94]">STAGE / UNIT</div>
                  <div className="font-bold text-white">212 Mercer · Unit 4</div>
                </div>
                <div>
                  <div className="text-[10px] text-[#A09C94]">ORIGIN REGION</div>
                  <div className="font-bold text-[#E04826] truncate">
                    {activeOrderTicket.region.split('·')[0]}
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons: Send to Gmail & WhatsApp */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => setPendingGmailBooking(activeOrderTicket)}
                className="w-full h-12 rounded-2xl bg-[#E04826] hover:bg-[#C93D1E] text-white font-mono text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Mail className="w-4 h-4" />
                <span>
                  {activeOrderTicket.gmailSent
                    ? `RESEND CONFIRMATION ORDER TO GMAIL (${activeOrderTicket.customerEmail})`
                    : `GET CONFIRMATION ORDER IN GMAIL (${activeOrderTicket.customerEmail})`}
                </span>
              </button>

              <a
                href={buildWhatsAppUrl(activeOrderTicket)}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full h-12 rounded-2xl bg-[#181614] hover:bg-[#2B2925] text-white font-mono text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <MessageCircle className="w-4 h-4 text-[#25D366]" />
                <span>SEND ORDER & TICKET ON WHATSAPP</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL 3: WHATSAPP ORDER CONCIERGE MODAL ==================== */}
      {showWhatsAppModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-[32px] bg-[#FAF8F5] border border-[#E5E0D5] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-[#181614] text-[#25D366] flex items-center justify-center">
                  <MessageCircle className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-mono text-[10px] text-[#6E6A63] uppercase">
                    WHATSAPP INSTANT DISPATCH
                  </div>
                  <h3 className="text-lg font-extrabold text-[#161513]">
                    Studio 04 WhatsApp Order
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowWhatsAppModal(false)}
                className="w-9 h-9 rounded-full bg-[#EAE5DC] flex items-center justify-center text-[#161513] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-2xl bg-[#E7F8ED] border border-[#B9E8C9] p-4 font-mono text-xs text-[#161513] space-y-1.5 mb-5">
              <div className="font-bold text-[#116132]">
                *STUDIO 04 · REEL SHOOTS CONFIRMATION ORDER*
              </div>
              <div>Order ID: {latestBooking.orderId}</div>
              <div>Ticket Pass: {latestBooking.ticketId}</div>
              <div>Creator: {latestBooking.customerName}</div>
              <div>
                Slot: {formatShortDateHeader(latestBooking.dateStr)} · {latestBooking.slotTime}
              </div>
              <div>
                Package: {latestBooking.packageName} (${latestBooking.price})
              </div>
              <div>User Region: {latestBooking.region}</div>
              <div>Studio: 212 Mercer Lane, Unit 4</div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <a
                href={buildWhatsAppUrl(latestBooking)}
                target="_blank"
                rel="noopener noreferrer"
                className="h-12 rounded-2xl bg-[#181614] hover:bg-[#2B2925] text-white font-mono text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <MessageCircle className="w-4 h-4 text-[#25D366]" />
                <span>Open WhatsApp</span>
              </a>
              <button
                type="button"
                onClick={() => {
                  setShowWhatsAppModal(false);
                  setActiveOrderTicket(latestBooking);
                }}
                className="h-12 rounded-2xl bg-[#E04826] hover:bg-[#C93D1E] text-white font-mono text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Ticket className="w-4 h-4" />
                <span>View Ticket</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL 4: MANDATORY GMAIL SEND CONFIRMATION DIALOG ==================== */}
      {pendingGmailBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-[32px] bg-[#FAF8F5] border border-[#E5E0D5] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-[#E04826]" />
                <h3 className="text-lg font-extrabold text-[#161513]">
                  Confirm Gmail Order Delivery
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingGmailBooking(null);
                  setGmailSendStatus({ type: 'idle' });
                }}
                className="w-8 h-8 rounded-full bg-[#EAE5DC] flex items-center justify-center text-[#161513] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#57534E] leading-relaxed mb-4">
              You are about to send an email via your connected Gmail account containing your{' '}
              <strong>Studio 04 Confirmation Order ({pendingGmailBooking.orderId})</strong> and{' '}
              <strong>Confirmation Ticket ({pendingGmailBooking.ticketId})</strong>:
            </p>

            <div className="rounded-2xl bg-white border border-[#E5E0D5] p-3.5 font-mono text-xs space-y-1 mb-4">
              <div>
                <span className="text-[#6E6A63]">To:</span>{' '}
                <strong>{pendingGmailBooking.customerEmail}</strong>
              </div>
              <div>
                <span className="text-[#6E6A63]">Subject:</span> Studio 04 Confirmation Order{' '}
                {pendingGmailBooking.orderId} & Ticket
              </div>
              <div>
                <span className="text-[#6E6A63]">Slot:</span>{' '}
                {formatShortDateHeader(pendingGmailBooking.dateStr)} ·{' '}
                {pendingGmailBooking.slotTime}
              </div>
              <div>
                <span className="text-[#6E6A63]">Region:</span> {pendingGmailBooking.region}
              </div>
            </div>

            {!accessToken && (
              <div className="mb-4 p-3 rounded-2xl bg-[#F5F3EE] border border-[#E5E0D5] flex items-center justify-between gap-2">
                <span className="text-xs text-[#57534E]">
                  Sign in with Google to authorize sending via Gmail:
                </span>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isSigningIn}
                  className="gsi-material-button"
                >
                  <div className="gsi-material-button-content-wrapper">
                    <span className="gsi-material-button-contents">
                      {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
                    </span>
                  </div>
                </button>
              </div>
            )}

            {gmailSendStatus.type !== 'idle' && (
              <div
                className={`mb-4 p-3 rounded-2xl font-mono text-xs ${
                  gmailSendStatus.type === 'success'
                    ? 'bg-[#DFF0D8] text-[#2B542C]'
                    : gmailSendStatus.type === 'error'
                    ? 'bg-[#F2DEDE] text-[#A94442]'
                    : 'bg-[#EAE5DC] text-[#161513]'
                }`}
              >
                {gmailSendStatus.message}
              </div>
            )}

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setPendingGmailBooking(null);
                  setGmailSendStatus({ type: 'idle' });
                }}
                className="flex-1 h-11 rounded-2xl border border-[#DCD7CD] text-xs font-mono font-semibold text-[#161513] hover:bg-[#EAE5DC] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={gmailSendStatus.type === 'sending'}
                onClick={executeConfirmedGmailSend}
                className="flex-1 h-11 rounded-2xl bg-[#E04826] hover:bg-[#C93D1E] text-white text-xs font-mono font-bold transition-colors cursor-pointer"
              >
                {gmailSendStatus.type === 'sending' ? 'Sending...' : 'Confirm & Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
