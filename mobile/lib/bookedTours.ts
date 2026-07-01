import { storage } from '@/lib/storage';
import { api } from '@/lib/api';
import type { ViatorBookingRecord } from '@/lib/api';

export const BOOKED_TOURS_STORAGE_KEY = 'trailhead_booked_tours_v1';

export type BookedTourStatus = 'confirmed' | 'pending' | 'cancelled';

export type BookedTour = {
  id: string;
  title: string;
  productTitle?: string;
  location?: string;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  quantity?: number;
  totalPrice?: string;
  currency?: string;
  imageUrl?: string;
  status?: BookedTourStatus;
  confirmationCode?: string;
  cancellationSummary?: string;
  cancellationUntil?: string;
  ticketUrl?: string;
  detailsUrl?: string;
  calendarNote?: string;
  bookedAt?: string;
};

function cleanTour(raw: any): BookedTour | null {
  const id = String(raw?.id || raw?.booking_id || raw?.confirmationCode || '').trim();
  const title = String(raw?.title || raw?.productTitle || raw?.product_title || '').trim();
  if (!id || !title) return null;
  const statusRaw = String(raw?.status || 'confirmed').toLowerCase();
  const status: BookedTourStatus = statusRaw === 'cancelled' || statusRaw === 'canceled'
    ? 'cancelled'
    : ['pending', 'intent', 'held', 'availability_checked', 'status_checked', 'provider_pending', 'cancel_quote'].includes(statusRaw)
      ? 'pending'
      : 'confirmed';
  const quantity = Number(raw?.quantity ?? raw?.traveler_count ?? raw?.count ?? 1);
  return {
    id,
    title,
    productTitle: String(raw?.productTitle || raw?.product_title || title).trim(),
    location: String(raw?.location || raw?.region || raw?.destination || '').trim() || undefined,
    startAt: String(raw?.startAt || raw?.start_at || raw?.start_date || '').trim() || undefined,
    endAt: String(raw?.endAt || raw?.end_at || raw?.end_date || '').trim() || undefined,
    timezone: String(raw?.timezone || raw?.time_zone || '').trim() || undefined,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1,
    totalPrice: String(raw?.totalPrice || raw?.total_price || raw?.price || '').trim() || undefined,
    currency: String(raw?.currency || '').trim() || undefined,
    imageUrl: String(raw?.imageUrl || raw?.image_url || raw?.hero_image_url || '').trim() || undefined,
    status,
    confirmationCode: String(raw?.confirmationCode || raw?.confirmation_code || '').trim() || undefined,
    cancellationSummary: String(raw?.cancellationSummary || raw?.cancellation_summary || '').trim() || undefined,
    cancellationUntil: String(raw?.cancellationUntil || raw?.cancellation_until || '').trim() || undefined,
    ticketUrl: String(raw?.ticketUrl || raw?.ticket_url || '').trim() || undefined,
    detailsUrl: String(raw?.detailsUrl || raw?.details_url || '').trim() || undefined,
    calendarNote: String(raw?.calendarNote || raw?.calendar_note || '').trim() || undefined,
    bookedAt: String(raw?.bookedAt || raw?.booked_at || '').trim() || undefined,
  };
}

function tourFromViatorBooking(booking: ViatorBookingRecord): BookedTour | null {
  return cleanTour({
    id: booking.id,
    booking_id: booking.id,
    title: booking.product_title || booking.product_code,
    product_title: booking.product_title || booking.product_code,
    start_date: booking.travel_date,
    status: booking.status,
    confirmation_code: booking.booking_reference,
    total_price: booking.amount != null ? String(booking.amount) : '',
    currency: booking.currency,
    ticket_url: booking.voucher_url,
    details_url: booking.booking_url,
    booked_at: booking.updated_at ? new Date(booking.updated_at * 1000).toISOString() : '',
  });
}

function mergeTours(primary: BookedTour[], secondary: BookedTour[]) {
  const seen = new Set<string>();
  const merged: BookedTour[] = [];
  for (const tour of [...primary, ...secondary]) {
    if (seen.has(tour.id)) continue;
    seen.add(tour.id);
    merged.push(tour);
  }
  return merged.sort((a, b) => tourTime(a) - tourTime(b));
}

function tourTime(tour: BookedTour) {
  const value = Date.parse(tour.startAt || tour.bookedAt || '');
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

async function loadLocalBookedTours(): Promise<BookedTour[]> {
  const raw = await storage.get(BOOKED_TOURS_STORAGE_KEY).catch(() => null);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(cleanTour)
      .filter((tour): tour is BookedTour => !!tour)
      .sort((a, b) => tourTime(a) - tourTime(b));
  } catch {
    return [];
  }
}

export async function loadBookedTours(): Promise<BookedTour[]> {
  const local = await loadLocalBookedTours();
  try {
    const remote = await api.getViatorBookings(50);
    const tours = (remote.bookings || [])
      .map(tourFromViatorBooking)
      .filter((tour): tour is BookedTour => !!tour);
    return mergeTours(tours, local);
  } catch {
    return local;
  }
}

export async function saveBookedTours(tours: BookedTour[]) {
  const clean = tours
    .map(cleanTour)
    .filter((tour): tour is BookedTour => !!tour)
    .sort((a, b) => tourTime(a) - tourTime(b));
  await storage.set(BOOKED_TOURS_STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

export async function saveBookedTour(tour: BookedTour) {
  const clean = cleanTour(tour);
  if (!clean) return loadBookedTours();
  const existing = await loadLocalBookedTours();
  return saveBookedTours([clean, ...existing.filter(item => item.id !== clean.id)]);
}
