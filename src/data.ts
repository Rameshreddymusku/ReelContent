export interface TimeSlot {
  id: string;
  startTime: string;
  endTime: string;
  durationMin: number;
  defaultBooked: boolean;
}

export interface StudioPackage {
  name: 'Creator' | 'Brand Pro' | 'Full Production';
  price: number;
  summary: string;
  perks: string;
}

export interface BookingRecord {
  id: string;
  orderId: string;
  ticketId: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  region: string;
  timezone: string;
  dateStr: string;
  slotTime: string;
  packageName: 'Creator' | 'Brand Pro' | 'Full Production';
  price: number;
  status: 'CONFIRMED' | 'CANCELLED';
  gmailSent: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ContactInquiryRecord {
  id: string;
  userId: string;
  name: string;
  email: string;
  message: string;
  region: string;
  createdAt?: unknown;
}

export interface RegionVisitRecord {
  id: string;
  userId: string;
  userEmail: string;
  region: string;
  timezone: string;
  language: string;
  updatedAt?: unknown;
}

export const STUDIO_PACKAGES: StudioPackage[] = [
  {
    name: 'Creator',
    price: 129,
    summary: '90 min · Cyc wall + 2 Aputure lights',
    perks: '4K vertical rig · Wireless mic',
  },
  {
    name: 'Brand Pro',
    price: 249,
    summary: '90 min · Multi-set access + Grip kit',
    perks: 'Lighting tech · Teleprompter',
  },
  {
    name: 'Full Production',
    price: 449,
    summary: '90 min · Camera op + Live reel cut',
    perks: 'RED Komodo · Same-day raw transfer',
  },
];

export const REGION_OPTIONS: string[] = [
  'South Asia · India (Hyderabad / Mumbai)',
  'North America · US West (Los Angeles / SF)',
  'North America · US East (New York / Mercer)',
  'Europe · UK & Ireland (London)',
  'Europe · Central (Berlin / Paris)',
  'Middle East · UAE (Dubai)',
  'Asia Pacific · Singapore & Tokyo',
  'Australia & NZ (Sydney / Melbourne)',
];

export function detectUserRegion(): { region: string; timezone: string; language: string } {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
    const lang = navigator.language || 'en-US';
    const lowerTz = tz.toLowerCase();

    let region = 'North America · US West (Los Angeles / SF)';
    if (lowerTz.includes('calcutta') || lowerTz.includes('kolkata') || lowerTz.includes('asia/colombo')) {
      region = 'South Asia · India (Hyderabad / Mumbai)';
    } else if (lowerTz.includes('new_york') || lowerTz.includes('chicago') || lowerTz.includes('toronto')) {
      region = 'North America · US East (New York / Mercer)';
    } else if (lowerTz.includes('london') || lowerTz.includes('dublin')) {
      region = 'Europe · UK & Ireland (London)';
    } else if (lowerTz.includes('europe/')) {
      region = 'Europe · Central (Berlin / Paris)';
    } else if (lowerTz.includes('dubai') || lowerTz.includes('riyadh')) {
      region = 'Middle East · UAE (Dubai)';
    } else if (lowerTz.includes('singapore') || lowerTz.includes('tokyo') || lowerTz.includes('hong_kong')) {
      region = 'Asia Pacific · Singapore & Tokyo';
    } else if (lowerTz.includes('sydney') || lowerTz.includes('melbourne') || lowerTz.includes('auckland')) {
      region = 'Australia & NZ (Sydney / Melbourne)';
    }

    return { region, timezone: tz, language: lang };
  } catch {
    return {
      region: 'South Asia · India (Hyderabad / Mumbai)',
      timezone: 'Asia/Kolkata',
      language: 'en-IN',
    };
  }
}

export const DAILY_TIME_SLOTS: TimeSlot[] = [
  { id: '09:00', startTime: '09:00', endTime: '10:30', durationMin: 90, defaultBooked: true },
  { id: '10:30', startTime: '10:30', endTime: '12:00', durationMin: 90, defaultBooked: false },
  { id: '12:00', startTime: '12:00', endTime: '13:30', durationMin: 90, defaultBooked: false },
  { id: '13:30', startTime: '13:30', endTime: '15:00', durationMin: 90, defaultBooked: true },
  { id: '15:00', startTime: '15:00', endTime: '16:30', durationMin: 90, defaultBooked: true },
  { id: '16:30', startTime: '16:30', endTime: '18:00', durationMin: 90, defaultBooked: false },
  { id: '18:00', startTime: '18:00', endTime: '19:30', durationMin: 90, defaultBooked: false },
];

// Availability status for October 2026 calendar dots matching the screenshots
export type DayStatus = 'past' | 'open' | 'few' | 'closed';

export function getOct2026DayStatus(day: number): DayStatus {
  if (day < 24) return 'past';
  if (day === 25) return 'closed';
  if (day === 27 || day === 30) return 'few';
  return 'open';
}

export function formatShortDateHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
  const month = dateObj.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday}, ${d} ${month}`;
}

export function formatBadgeParts(dateStr: string): { month: string; day: string; weekday: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  return {
    month: dateObj.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
    day: String(d).padStart(2, '0'),
    weekday: dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
  };
}

// Initial Confirmed Booking matching Screenshot 5 (OCT 28 Wed, 13:30 - 15:00, Creator · $129)
export const INITIAL_SAMPLE_BOOKINGS: BookingRecord[] = [
  {
    id: 'bk-oct28-1330',
    orderId: 'ORD-2026-0428',
    ticketId: 'TKT-S04-2810',
    userId: 'studio-member-ramesh',
    customerName: 'Ramesh Reddy Musku',
    customerEmail: 'rameshreddymusku18@gmail.com',
    customerPhone: '+91 98480 21204',
    region: 'South Asia · India (Hyderabad / Mumbai)',
    timezone: 'Asia/Kolkata',
    dateStr: '2026-10-28',
    slotTime: '13:30 - 15:00',
    packageName: 'Creator',
    price: 129,
    status: 'CONFIRMED',
    gmailSent: true,
  },
];
