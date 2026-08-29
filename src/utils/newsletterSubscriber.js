import {
  getEmailCaptureSuppressionReason,
  isNewsletterGuideSuppressed,
} from './welcomeDiscount';

export const NEWSLETTER_SUBSCRIBER_STORAGE_KEY = 'zajkologia.newsletterSubscriber:v1';
export const NEWSLETTER_SUBSCRIBER_COOKIE_KEY = 'zajkologia.newsletterSubscriber.v1';
export const NEWSLETTER_SUBSCRIBER_CHANGED_EVENT = 'zajkologia:newsletter-subscriber-changed';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const LEGACY_SUBSCRIBER_REASONS = new Set(['subscribed', 'discount_activated']);

const getCookie = (name) => {
  if (typeof document === 'undefined' || !document.cookie) return '';

  const prefix = `${name}=`;
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!cookie) return '';

  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return cookie.slice(prefix.length);
  }
};

const setSubscriberCookie = (value, maxAge = ONE_YEAR_SECONDS) => {
  if (typeof document === 'undefined') return;
  document.cookie = `${NEWSLETTER_SUBSCRIBER_COOKIE_KEY}=${value}; Max-Age=${maxAge}; path=/; SameSite=Lax`;
};

export const isNewsletterSubscriberRecognized = () => {
  if (typeof window === 'undefined') return false;

  try {
    if (window.localStorage.getItem(NEWSLETTER_SUBSCRIBER_STORAGE_KEY) === 'true') {
      return true;
    }
  } catch {
    // Fall through to the cookie and safe legacy markers.
  }

  if (getCookie(NEWSLETTER_SUBSCRIBER_COOKIE_KEY) === 'true') return true;

  // Both legacy states below were written only after a confirmed newsletter signup.
  if (isNewsletterGuideSuppressed()) return true;
  return LEGACY_SUBSCRIBER_REASONS.has(getEmailCaptureSuppressionReason());
};

export const markNewsletterSubscriberRecognized = () => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(NEWSLETTER_SUBSCRIBER_STORAGE_KEY, 'true');
  } catch {
    // The SameSite cookie remains available when localStorage is blocked.
  }

  setSubscriberCookie('true');
  window.dispatchEvent(new CustomEvent(NEWSLETTER_SUBSCRIBER_CHANGED_EVENT));
};

export const clearNewsletterSubscriberRecognition = () => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(NEWSLETTER_SUBSCRIBER_STORAGE_KEY);
  } catch {
    // Ignore storage failures; clearing the cookie still covers the fallback.
  }

  setSubscriberCookie('', 0);
  window.dispatchEvent(new CustomEvent(NEWSLETTER_SUBSCRIBER_CHANGED_EVENT));
};
