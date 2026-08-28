import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, Copy, FileText, Mail, Tag, X } from 'lucide-react';
import { loadWelcomeDiscountOffer, signupForWelcomeDiscount } from '../api/client';
import { useCart } from '../cart/useCart';
import {
  EMAIL_CAPTURE_VISIBILITY_CHANGED_EVENT,
  WELCOME_DISCOUNT_OFFER_CHANGED_EVENT,
  getStoredWelcomeDiscountOffer,
  isEmailCaptureSuppressed,
  isNewsletterGuideSuppressed,
  normalizeWelcomeDiscountCode,
  suppressEmailCaptureOffers,
  suppressNewsletterGuideOffer,
  storeWelcomeDiscountOffer,
} from '../utils/welcomeDiscount';
import '../styles/email-capture.css';

export const MARKETING_CONSENT_TEXT =
  'Súhlasím, aby mi Zajkológia na zadanú e-mailovú adresu posielala marketingové a newsletterové e-maily. Môžu obsahovať užitočné informácie o starostlivosti o králiky, novinky, produktové tipy a občasné ponuky. Súhlas môžem kedykoľvek odvolať.';

const formatOfferAmount = (offer) => {
  if (offer?.discountType === 'percent_off' && Number(offer.percentOff) > 0) {
    return `${Number(offer.percentOff)}%`;
  }
  if (offer?.discountType === 'amount_off' && Number(offer.amountOff) > 0) {
    return new Intl.NumberFormat('sk-SK', {
      style: 'currency',
      currency: String(offer.currency || 'EUR').toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(Number(offer.amountOff) / 100);
  }
  return '';
};

const createPlacementCopy = (offer) => {
  const offerAmount = formatOfferAmount(offer);
  const discountAccusative = offerAmount ? `${offerAmount} zľavu` : 'uvítaciu zľavu';
  const discountNominative = offerAmount ? `${offerAmount} zľava` : 'Uvítacia zľava';

  const baseCopy = {
    eyebrow: `${discountNominative} na prvý nákup`,
    headline: '',
    subheadline:
      `Chceš dostávať užitočné tipy o starostlivosti, novinky a občasné ponuky? Ako poďakovanie od nás získaš ${discountAccusative} na prvý nákup.`,
    benefit: '',
    emailLabel: 'E-mailová adresa',
    emailPlaceholder: 'tvoj@email.sk',
    consentLabel: 'Súhlasím so zasielaním newslettera a marketingových e-mailov.',
    consentDetailsLabel: 'Zobraziť viac detailov',
    cta: `Získať ${discountAccusative}`,
    successTitle: 'Ďakujeme',
    success:
      'Zľavový kód uplatníme automaticky pri nákupe.',
    emailSent:
      'Hotovo, poslali sme ti e-mail so zľavou. Klikni na tlačidlo v e-maile a zľavu aktivujeme pre nákup v tomto prehliadači.',
    discountIntro: offerAmount ? `Tvoj uvítací kód na ${offerAmount}:` : 'Tvoj uvítací kód:',
    invalidEmail: 'Zadaj prosím platnú e-mailovú adresu.',
    missingConsent:
      'Na získanie zľavy je potrebný súhlas so zasielaním marketingových/newsletterových e-mailov.',
    emailFailed:
      'E-mail so zľavou sa nepodarilo odoslať. Skús to prosím znova o chvíľu.',
    rateLimited:
      'Dosiahol sa limit odosielania. Skontroluj si e-mail alebo to skús znova o hodinu.',
    alreadySubscribed:
      'Tento e-mail už máme v zozname. Uvítacia zľava je pripravená:',
    discountUsed:
      'Tento e-mail už máme v zozname a uvítacia zľava preň už bola použitá. Tipy a novinky ti budeme posielať ďalej.',
    discountReserved:
      'Uvítacia zľava je už pripravená v otvorenej pokladni. Dokonči otvorenú platbu alebo to skús neskôr.',
    discountIpLimit:
      'Z tejto siete už bolo vytvorených viac uvítacích zliav. Ak si myslíš, že ide o omyl, napíš nám na kontakt@zajkologia.com.',
  };

  return {
    home: {
      ...baseCopy,
      eyebrow: '',
      headline:
        'Buď medzi prvými, ktorí sa dozvedia o nových článkoch a tipoch, a získaj príručku zadarmo.',
      subheadline:
        'Prihlás sa na odber noviniek od Zajkológie a získaj prístup k novým článkom, praktickým tipom a užitočným informáciám o starostlivosti o králiky. Navyše ti pošleme aj PDF príručku zdarmo.',
      benefit:
        'Ako bonus za prihlásenie získaš zadarmo PDF príručku so základmi starostlivosti o králika.',
      emailLabel: 'Zadaj svoj e-mail',
      consentLabel:
        'Súhlasím so zasielaním newslettera, nových článkov a ďalších e-mailov od Zajkológie.',
      consentDetailsLabel: 'Viac informácií',
      cta: 'Chcem dostávať novinky',
      successTitle: 'Ďakujeme!',
      emailSent: 'Skontroluj si e-mail. Príručku sme ti poslali v prílohe.',
      missingConsent:
        'Na odber newslettera a zaslanie príručky je potrebný súhlas so zasielaním e-mailov.',
      emailFailed:
        'E-mail s príručkou sa nepodarilo odoslať. Skús to prosím znova o chvíľu.',
      discountUsed: 'Skontroluj si e-mail. Príručku sme ti poslali v prílohe.',
      discountReserved: 'Skontroluj si e-mail. Príručku sme ti poslali v prílohe.',
      discountIpLimit: 'Skontroluj si e-mail. Príručku sme ti poslali v prílohe.',
    },
    product: {
      ...baseCopy,
      eyebrow: 'Uvítacia zľava',
      headline: `Získaj ${discountAccusative} na tento produkt`,
      subheadline:
        'Ak chceš praktické rady k starostlivosti o králika aj občasné novinky zo Zajkológie, prihlás sa do e-mailového zoznamu a získaj uvítací kód.',
      benefit: 'Zľavu uplatníme automaticky pri prechode do pokladne.',
      cta: 'Chcem zľavový kód',
    },
    article: {
      ...baseCopy,
      eyebrow: 'Pokračuj so Zajkológiou',
      headline: 'Páčia sa ti praktické rady ku králikom?',
      subheadline:
        `Pridaj sa do e-mailového zoznamu a dostaneš ďalšie užitočné tipy, novinky a občasné ponuky. Ako poďakovanie ti pošleme ${discountAccusative} na prvý nákup.`,
      benefit: 'Pokojnejšia starostlivosť začína pri dobrých informáciách.',
      cta: 'Pridať sa a získať zľavu',
    },
  };
};

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

const EmailCaptureOffer = ({ placement = 'home' }) => {
  const { applyCoupon } = useCart();
  const emailId = useId();
  const headingId = useId();
  const consentId = useId();
  const consentDetailsTitleId = useId();
  const consentDetailsDescriptionId = useId();
  const consentDetailsTriggerRef = useRef(null);
  const consentDialogRef = useRef(null);
  const consentDialogCloseRef = useRef(null);
  const [offer, setOffer] = useState(null);
  const [offerAvailability, setOfferAvailability] = useState('loading');
  const placementCopy = createPlacementCopy(offer);
  const copy = placementCopy[placement] || placementCopy.home;

  const [email, setEmail] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [discountCode, setDiscountCode] = useState('');
  const [discountToken, setDiscountToken] = useState('');
  const [discountAvailable, setDiscountAvailable] = useState(false);
  const [discountUnavailableReason, setDiscountUnavailableReason] = useState('');
  const [awaitingEmailClick, setAwaitingEmailClick] = useState(false);
  const [alreadySubscribed, setAlreadySubscribed] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('idle');
  const [copied, setCopied] = useState(false);
  const [isSuppressed, setIsSuppressed] = useState(() => (
    placement === 'home' ? isNewsletterGuideSuppressed() : isEmailCaptureSuppressed()
  ));

  useEffect(() => {
    let active = true;
    loadWelcomeDiscountOffer()
      .then((nextOffer) => {
        if (!active) return;
        setOffer(nextOffer);
        setOfferAvailability(nextOffer ? 'available' : 'unavailable');
      })
      .catch(() => {
        if (active) setOfferAvailability('unknown');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const syncStoredOffer = () => {
      const storedOffer = getStoredWelcomeDiscountOffer();
      setDiscountCode(storedOffer.discountCode);
      setDiscountToken(storedOffer.discountToken);
      setDiscountAvailable(Boolean(storedOffer.discountCode && storedOffer.discountToken));
      if (storedOffer.discountCode && storedOffer.discountToken) {
        setDiscountUnavailableReason('');
        setAwaitingEmailClick(false);
      }
    };

    syncStoredOffer();
    window.addEventListener(WELCOME_DISCOUNT_OFFER_CHANGED_EVENT, syncStoredOffer);
    return () => {
      window.removeEventListener(WELCOME_DISCOUNT_OFFER_CHANGED_EVENT, syncStoredOffer);
    };
  }, []);

  useEffect(() => {
    const syncSuppression = () => {
      setIsSuppressed(
        placement === 'home' ? isNewsletterGuideSuppressed() : isEmailCaptureSuppressed()
      );
    };

    syncSuppression();
    window.addEventListener(EMAIL_CAPTURE_VISIBILITY_CHANGED_EVENT, syncSuppression);
    return () => {
      window.removeEventListener(EMAIL_CAPTURE_VISIBILITY_CHANGED_EVENT, syncSuppression);
    };
  }, [placement]);

  const restoreConsentDetailsFocus = () => {
    consentDetailsTriggerRef.current?.focus();
  };

  const openConsentDetails = () => {
    const dialog = consentDialogRef.current;
    if (!dialog || dialog.open) return;

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    const focusCloseButton = () => consentDialogCloseRef.current?.focus();
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusCloseButton);
    } else {
      focusCloseButton();
    }
  };

  const closeConsentDetails = () => {
    const dialog = consentDialogRef.current;
    if (!dialog) return;

    if (dialog.open && typeof dialog.close === 'function') {
      dialog.close();
      return;
    }

    dialog.removeAttribute('open');
    restoreConsentDetailsFocus();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedEmail = email.trim();

    if (!isValidEmail(trimmedEmail)) {
      setError(copy.invalidEmail);
      return;
    }

    if (!consentAccepted) {
      setError(copy.missingConsent);
      return;
    }

    setStatus('submitting');
    setError('');
    setAlreadySubscribed(false);
    setAwaitingEmailClick(false);

    try {
      const data = await signupForWelcomeDiscount({
        email: trimmedEmail,
        consentAccepted,
        source: placement,
        incentive: placement === 'home' ? 'care-guide' : undefined,
      });
      if (data?.offer) setOffer(data.offer);
      const normalizedDiscountCode = normalizeWelcomeDiscountCode(data?.discountCode);

      if (placement === 'home' && data?.guideDelivery === 'email') {
        setDiscountCode('');
        setDiscountToken('');
        setDiscountAvailable(false);
        setDiscountUnavailableReason('');
        setAwaitingEmailClick(true);
        setAlreadySubscribed(Boolean(data.alreadySubscribed));
        setStatus('success');
        suppressNewsletterGuideOffer();
        return;
      }

      if (data?.discountAvailable && data?.emailSent && !data?.discountToken) {
        setDiscountCode(normalizedDiscountCode);
        setDiscountToken('');
        setDiscountAvailable(false);
        setDiscountUnavailableReason('');
        setAwaitingEmailClick(true);
        setAlreadySubscribed(Boolean(data.alreadySubscribed));
        setStatus('success');
        suppressEmailCaptureOffers('subscribed');
        return;
      }

      if (!normalizedDiscountCode || !data?.discountToken) {
        if (data?.discountAvailable === false) {
          setDiscountCode('');
          setDiscountToken('');
          setDiscountAvailable(false);
          setDiscountUnavailableReason(data?.discountUnavailableReason || '');
          setAwaitingEmailClick(false);
          setAlreadySubscribed(Boolean(data.alreadySubscribed));
          setStatus('success');
          suppressEmailCaptureOffers('subscribed');
          return;
        }

        throw new Error('missing_discount_code');
      }

      storeWelcomeDiscountOffer({
        discountCode: normalizedDiscountCode,
        discountToken: data.discountToken,
      });
      applyCoupon({
        code: normalizedDiscountCode,
        claimToken: data.discountToken,
        source: 'welcome',
      });
      setDiscountCode(normalizedDiscountCode);
      setDiscountToken(data.discountToken);
      setDiscountAvailable(Boolean(data.discountAvailable));
      setDiscountUnavailableReason('');
      setAwaitingEmailClick(false);
      setAlreadySubscribed(Boolean(data.alreadySubscribed));
      setStatus('success');
      suppressEmailCaptureOffers('subscribed');
    } catch (err) {
      if (err?.data?.error === 'consent_required') {
        setError(copy.missingConsent);
      } else if (err?.data?.error === 'invalid_email') {
        setError(copy.invalidEmail);
      } else if (err?.data?.error === 'welcome_email_failed') {
        setError(copy.emailFailed);
      } else if (err?.data?.error === 'newsletter_rate_limited') {
        setError(copy.rateLimited);
      } else {
        setError('Prihlásenie sa nepodarilo. Skúste to prosím znova.');
      }
      setStatus('idle');
    }
  };

  const copyDiscountCode = async () => {
    if (!discountCode || !navigator?.clipboard) return;

    try {
      await navigator.clipboard.writeText(discountCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const hasDiscountCode = Boolean(discountCode && discountToken && discountAvailable);
  const showSuccessWithoutDiscount = status === 'success' && !hasDiscountCode;
  const unavailableMessage =
    discountUnavailableReason === 'reserved'
      ? copy.discountReserved
      : discountUnavailableReason?.startsWith?.('ip_')
        ? copy.discountIpLimit
        : copy.discountUsed;
  const successMessage = hasDiscountCode
    ? (alreadySubscribed ? copy.alreadySubscribed : copy.success)
    : awaitingEmailClick
      ? copy.emailSent
      : unavailableMessage;
  const successTitle = placement === 'home'
    ? copy.successTitle
    : hasDiscountCode && !alreadySubscribed
      ? copy.successTitle
      : '';

  if (
    (isSuppressed || (placement !== 'home' && offerAvailability === 'unavailable')) &&
    status !== 'success'
  ) return null;

  return (
    <>
      <section
        className={`email-offer email-offer--${placement}`}
        aria-labelledby={copy.headline ? headingId : undefined}
        aria-label={copy.headline ? undefined : copy.eyebrow}
      >
        <div className="email-offer__copy">
          {copy.eyebrow && (
            <span className="email-offer__eyebrow">
              <Tag size={15} aria-hidden="true" />
              {copy.eyebrow}
            </span>
          )}
          {copy.headline && <h2 id={headingId}>{copy.headline}</h2>}
          <p>{copy.subheadline}</p>
          {copy.benefit && (
            <p className="email-offer__benefit">
              <CheckCircle2 size={17} aria-hidden="true" />
              {copy.benefit}
            </p>
          )}
        </div>

        {hasDiscountCode || awaitingEmailClick || showSuccessWithoutDiscount ? (
          <div className="email-offer__success" aria-live="polite">
            <div className="email-offer__success-heading">
              <div className="email-offer__success-icon">
                <Mail size={18} aria-hidden="true" />
              </div>
              {successTitle && <strong>{successTitle}</strong>}
            </div>
            <p>{successMessage}</p>
            {hasDiscountCode && (
              <>
                <span className="email-offer__code-label">{copy.discountIntro}</span>
                <div className="email-offer__code-row">
                  <strong>{discountCode}</strong>
                  <button type="button" onClick={copyDiscountCode} className="email-offer__copy-button">
                    <Copy size={16} aria-hidden="true" />
                    {copied ? 'Skopírované' : 'Skopírovať'}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <form
            className="email-offer__form"
            onSubmit={handleSubmit}
            noValidate
            aria-busy={status === 'submitting'}
          >
            <label className="email-offer__field" htmlFor={emailId}>
              <span>{copy.emailLabel}</span>
              <input
                id={emailId}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={copy.emailPlaceholder}
                autoComplete="email"
                required
              />
            </label>

            <div className="email-offer__consent">
              <input
                id={consentId}
                type="checkbox"
                checked={consentAccepted}
                onChange={(event) => setConsentAccepted(event.target.checked)}
                required
              />
              <div className="email-offer__consent-text">
                <label htmlFor={consentId}>
                  {copy.consentLabel}
                </label>{' '}
                <button
                  ref={consentDetailsTriggerRef}
                  type="button"
                  className="email-offer__details-button"
                  onClick={openConsentDetails}
                  aria-haspopup="dialog"
                >
                  {copy.consentDetailsLabel}
                </button>
              </div>
            </div>

            {error && (
              <div className="email-offer__error" role="alert">
                {error}
              </div>
            )}

            <button type="submit" className="email-offer__submit" disabled={status === 'submitting'}>
              <Mail size={17} aria-hidden="true" />
              {status === 'submitting' ? 'Odosielam…' : copy.cta}
            </button>
          </form>
        )}

        {placement === 'home' && (
          <figure className="email-offer__guide-visual">
            <img
              src="/newsletter/care-guide-mockup.png"
              width="6000"
              height="3375"
              loading="lazy"
              decoding="async"
              alt="Náhľad PDF príručky Základy starostlivosti o králika"
            />
            <figcaption>
              <FileText size={17} aria-hidden="true" />
              PDF príručka zdarma
            </figcaption>
          </figure>
        )}
      </section>

      <dialog
        ref={consentDialogRef}
        className="email-offer__modal"
        aria-labelledby={consentDetailsTitleId}
        aria-describedby={consentDetailsDescriptionId}
        onClose={restoreConsentDetailsFocus}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const clickedInside = event.clientX >= bounds.left && event.clientX <= bounds.right
            && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
          if (!clickedInside) closeConsentDetails();
        }}
      >
        <div className="email-offer__modal-header">
          <h3 id={consentDetailsTitleId}>Marketingový súhlas</h3>
          <button
            ref={consentDialogCloseRef}
            type="button"
            className="email-offer__modal-close"
            onClick={closeConsentDetails}
            aria-label="Zavrieť podrobnosti"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div id={consentDetailsDescriptionId} className="email-offer__modal-copy">
          <p>{MARKETING_CONSENT_TEXT}</p>
          <p>
            E-mail použijeme na zaslanie príručky a následne na newsletter Zajkológie.
            Z odberu sa môžeš kedykoľvek odhlásiť odkazom v pätičke každého e-mailu.
          </p>
        </div>
        <button
          type="button"
          className="email-offer__modal-action"
          onClick={closeConsentDetails}
        >
          Rozumiem
        </button>
      </dialog>
    </>
  );
};

export default EmailCaptureOffer;
