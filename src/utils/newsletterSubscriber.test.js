import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearEmailCaptureSuppression,
  suppressEmailCaptureOffers,
  suppressNewsletterGuideOffer,
} from './welcomeDiscount';
import {
  NEWSLETTER_SUBSCRIBER_STORAGE_KEY,
  clearNewsletterSubscriberRecognition,
  isNewsletterSubscriberRecognized,
  markNewsletterSubscriberRecognized,
} from './newsletterSubscriber';

beforeEach(() => {
  window.localStorage.clear();
  clearEmailCaptureSuppression();
  clearNewsletterSubscriberRecognition();
});

describe('newsletter subscriber recognition', () => {
  it('persists only a non-sensitive confirmed marker', () => {
    expect(isNewsletterSubscriberRecognized()).toBe(false);

    markNewsletterSubscriberRecognized();

    expect(isNewsletterSubscriberRecognized()).toBe(true);
    expect(window.localStorage.getItem(NEWSLETTER_SUBSCRIBER_STORAGE_KEY)).toBe('true');
  });

  it('recognizes safe legacy signup markers but not purchase-only suppression', () => {
    suppressEmailCaptureOffers('purchased');
    expect(isNewsletterSubscriberRecognized()).toBe(false);

    clearEmailCaptureSuppression();
    suppressEmailCaptureOffers('subscribed');
    expect(isNewsletterSubscriberRecognized()).toBe(true);

    clearEmailCaptureSuppression();
    suppressNewsletterGuideOffer();
    expect(isNewsletterSubscriberRecognized()).toBe(true);
  });
});
