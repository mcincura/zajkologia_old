import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import {
  CheckoutElementsProvider,
  PaymentElement,
  useCheckoutElements,
} from '@stripe/react-stripe-js/checkout';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Tag,
  X,
} from 'lucide-react';

import {
  cancelCheckoutAttempt,
  loadCheckoutAttempt,
  mutateCheckoutAttemptCoupon,
  recordCheckoutReturn,
  saveCheckoutCustomer,
} from '../api/client';
import {
  clearCheckoutAttempt,
  clearPendingCheckoutCouponMutation,
  getCheckoutAttempt,
  getPendingCheckoutCouponMutation,
  storePendingCheckoutCouponMutation,
} from '../checkout/attemptStore';
import { useCart } from '../cart/useCart';
import {
  clearStoredWelcomeDiscountOffer,
  suppressEmailCaptureOffers,
} from '../utils/welcomeDiscount';
import { getCouponErrorMessage, normalizeCouponCode } from '../utils/couponErrors';
import '../styles/checkout.css';

const stripePromiseCache = new Map();
const PROCESSING_POLL_MS = 1_500;
const PROCESSING_MAX_POLLS = 20;
const PAYMENT_ELEMENT_OPTIONS = {
  layout: 'accordion',
  wallets: { applePay: 'auto', googlePay: 'auto' },
  // These details are collected and locked in the first-party form, then
  // supplied to checkout.confirm(). Stripe must not collect them a second time.
  fields: {
    billingDetails: {
      name: 'never',
      email: 'never',
      phone: 'never',
      address: 'never',
    },
  },
};

const getStripePromise = (publishableKey) => {
  if (!stripePromiseCache.has(publishableKey)) {
    stripePromiseCache.set(publishableKey, loadStripe(publishableKey));
  }
  return stripePromiseCache.get(publishableKey);
};

const formatMoney = (amountMinor, currency = 'eur') => {
  try {
    return new Intl.NumberFormat('sk-SK', {
      style: 'currency',
      currency: String(currency || 'eur').toUpperCase(),
    }).format(Number(amountMinor || 0) / 100);
  } catch {
    return `${(Number(amountMinor || 0) / 100).toFixed(2)} ${String(currency || 'eur').toUpperCase()}`;
  }
};

const getErrorMessage = (error) => {
  const code = error?.data?.error || error?.code || error?.message;
  if (code === 'checkout_details_invalid') return 'Skontrolujte kontaktné a doručovacie údaje.';
  if (code === 'checkout_consent_version_stale') return 'Podmienky sa zmenili. Obnovte stránku a prečítajte si ich znova.';
  if (code === 'checkout_session_not_open') return 'Táto platba už bola odoslaná alebo pokladňa vypršala.';
  if (code === 'checkout_display_total_mismatch') return 'Cena sa zmenila. Platbu sme neodoslali; obnovte pokladňu.';
  if (code === 'checkout_rate_limited') return 'Príliš veľa pokusov. Počkajte chvíľu a skúste to znova.';
  if (code === 'checkout_details_already_finalized') return 'Údaje sú už bezpečne uzamknuté pre túto platbu.';
  return error?.message || 'Platbu sa nepodarilo odoslať. Skúste to prosím znova.';
};

const emptyContact = (country = 'SK') => ({
  name: '',
  phone: '',
  address: { line1: '', line2: '', city: '', state: '', postal_code: '', country },
});

const COUNTRY_LABELS = {
  SK: 'Slovensko',
  CZ: 'Česko',
};

const getInitialCustomer = (bootstrap) => {
  const saved = bootstrap.customer || {};
  const defaultCountry = bootstrap.display?.shipping?.allowedCountries?.[0] || 'SK';
  return {
    email: saved.email || bootstrap.display?.customer?.email || '',
    billing: saved.billing || emptyContact(defaultCountry),
    shipping: saved.shipping || emptyContact(defaultCountry),
    delivery: saved.delivery || (bootstrap.display?.hasPhysicalItems
      ? { method: '', pointId: '', addressConfirmed: false, instructions: '' }
      : null),
    consent: saved.consent || {
      accepted: false,
      version: bootstrap.display?.consent?.version || '',
    },
  };
};

const CheckoutCouponPanel = ({
  display,
  busy,
  disabled = false,
  locked,
  onApply,
  onRemove,
}) => {
  const appliedCoupon = display.coupon || null;
  const [draft, setDraft] = useState('');
  const [replacing, setReplacing] = useState(!appliedCoupon);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const errorRef = useRef(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const showError = (nextError, fallback) => {
    setStatus('');
    setError(getCouponErrorMessage(nextError, fallback));
  };

  const handleApply = async (event) => {
    event.preventDefault();
    if (busy || disabled || locked) return;
    const couponCode = normalizeCouponCode(draft);
    if (!couponCode) {
      setStatus('');
      setError('Zadajte zľavový kód.');
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    setError('');
    setStatus('Overujeme zľavový kód a novú konečnú cenu…');
    try {
      const next = await onApply(couponCode);
      const coupon = next.display?.coupon;
      setDraft('');
      setReplacing(false);
      setStatus(
        `Kód ${coupon?.code || couponCode} je použitý. Ušetríte ${formatMoney(
          next.display?.discountAmount,
          next.display?.currency
        )}.`
      );
    } catch (nextError) {
      showError(
        nextError,
        'Zľavu sa nepodarilo bezpečne použiť. Pôvodná cena zostala nezmenená; skúste to znova.'
      );
    }
  };

  const handleRemove = async () => {
    if (busy || disabled || locked) return;
    setError('');
    setStatus('Odstraňujeme zľavu a obnovujeme konečnú cenu…');
    try {
      const next = await onRemove();
      setDraft('');
      setReplacing(true);
      setStatus(`Zľavový kód bol odstránený. Nová suma je ${formatMoney(
        next.display?.total,
        next.display?.currency
      )}.`);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } catch (nextError) {
      showError(
        nextError,
        'Zľavu sa nepodarilo bezpečne odstrániť. Doterajšia cena zostala nezmenená; skúste to znova.'
      );
    }
  };

  const handleReplace = () => {
    setError('');
    setStatus('');
    setDraft('');
    setReplacing(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const inputErrorId = 'checkout-coupon-error';
  const inputStatusId = 'checkout-coupon-status';
  const describedBy = error ? inputErrorId : status ? inputStatusId : undefined;

  return (
    <section
      className="onsite-checkout__coupon-panel"
      aria-labelledby="checkout-coupon-title"
      aria-busy={busy}
    >
      <div className="onsite-checkout__coupon-heading">
        <div>
          <span className="onsite-checkout__coupon-kicker"><Tag size={15} aria-hidden="true" /> Zľava</span>
          <h3 id="checkout-coupon-title">Zľavový kód</h3>
        </div>
        {busy ? <span className="onsite-checkout__coupon-busy">Prepočítavame…</span> : null}
      </div>

      {appliedCoupon ? (
        <div className="onsite-checkout__coupon-applied">
          <CheckCircle2 size={19} aria-hidden="true" />
          <div>
            <strong>{appliedCoupon.name || appliedCoupon.code}</strong>
            <span>
              Kód {appliedCoupon.code} · úspora {formatMoney(
                display.discountAmount,
                display.currency
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy || disabled || locked}
            aria-label={`Odstrániť zľavový kód ${appliedCoupon.code}`}
          >
            <X size={16} aria-hidden="true" /> Odstrániť
          </button>
        </div>
      ) : null}

      {replacing ? (
        <form className="onsite-checkout__coupon-form" onSubmit={handleApply} noValidate>
          <label htmlFor="checkout-coupon-code">
            {appliedCoupon ? 'Nový zľavový kód' : 'Zľavový kód'}
          </label>
          <div className="onsite-checkout__coupon-input-row">
            <input
              id="checkout-coupon-code"
              ref={inputRef}
              name="coupon-code"
              value={draft}
              onChange={(event) => setDraft(event.target.value.toUpperCase())}
              placeholder="ZADAJTE KÓD"
              autoComplete="off"
              spellCheck="false"
              maxLength="64"
              disabled={busy || disabled || locked}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
            />
            <button type="submit" disabled={busy || disabled || locked}>
              {busy ? 'Overujeme…' : appliedCoupon ? 'Nahradiť' : 'Použiť'}
            </button>
          </div>
          {appliedCoupon ? (
            <button
              type="button"
              className="onsite-checkout__coupon-cancel-replace"
              onClick={() => {
                setReplacing(false);
                setDraft('');
                setError('');
              }}
              disabled={busy || disabled || locked}
            >
              Ponechať kód {appliedCoupon.code}
            </button>
          ) : null}
        </form>
      ) : appliedCoupon ? (
        <button
          type="button"
          className="onsite-checkout__coupon-replace"
          onClick={handleReplace}
          disabled={busy || disabled || locked}
        >
          Použiť iný kód
        </button>
      ) : null}

      {locked ? (
        <p className="onsite-checkout__coupon-locked">
          <LockKeyhole size={15} aria-hidden="true" />
          Zľavu možno zmeniť pred pokračovaním k platbe. Ak ju potrebujete upraviť,
          zrušte tento pokus a začnite znova.
        </p>
      ) : null}
      <p
        id={inputStatusId}
        className="onsite-checkout__coupon-message onsite-checkout__coupon-message--status"
        role="status"
        aria-live="polite"
      >
        {status}
      </p>
      {error ? (
        <p
          id={inputErrorId}
          className="onsite-checkout__coupon-message onsite-checkout__coupon-message--error"
          role="alert"
          tabIndex="-1"
          ref={errorRef}
        >
          {error}
        </p>
      ) : null}
    </section>
  );
};

const CheckoutSummary = ({ display, couponControl }) => (
  <aside className="onsite-checkout__summary" aria-labelledby="checkout-summary-title">
    <div className="onsite-checkout__summary-heading">
      <span className="onsite-checkout__eyebrow">Vaša objednávka</span>
      <h2 id="checkout-summary-title">Súhrn</h2>
    </div>
    <div className="onsite-checkout__items">
      {(display.items || []).map((item, index) => (
        <div className="onsite-checkout__item" key={`${item.productSlug}-${item.variantCode || index}`}>
          <div>
            <strong>{item.name}</strong>
            <span>{item.variantName ? `${item.variantName} · ` : ''}{item.quantity} ks</span>
          </div>
          <div className="onsite-checkout__item-price">
            {item.discountAmount > 0 ? <span>{formatMoney(item.unitAmount * item.quantity, item.currency)}</span> : null}
            <strong>{formatMoney(item.netAmount, item.currency)}</strong>
          </div>
        </div>
      ))}
    </div>
    <dl className="onsite-checkout__totals">
      <div><dt>Medzisúčet</dt><dd>{formatMoney(display.subtotal, display.currency)}</dd></div>
      {display.discountAmount > 0 ? (
        <div className="onsite-checkout__saving">
          <dt><Tag size={15} aria-hidden="true" /> Zľava {display.coupon?.code}</dt>
          <dd>− {formatMoney(display.discountAmount, display.currency)}</dd>
        </div>
      ) : null}
      {display.shipping?.amount > 0 ? <div><dt>Doprava · {display.shipping.label}</dt><dd>{formatMoney(display.shipping.amount, display.currency)}</dd></div> : null}
      <div className="onsite-checkout__total"><dt>Spolu</dt><dd>{formatMoney(display.total, display.currency)}</dd></div>
      {display.recurring ? <div className="onsite-checkout__renewal"><dt>Obnova</dt><dd>mesačne</dd></div> : null}
    </dl>
    {couponControl}
    <div className="onsite-checkout__trust">
      <ShieldCheck size={21} aria-hidden="true" />
      <p><strong>Bezpečná platba</strong><span>Platobné údaje spracuje Stripe. Zajkológia ich nevidí ani neukladá.</span></p>
    </div>
  </aside>
);

const CheckoutShell = ({ display, header, couponControl, children }) => (
  <div className="onsite-checkout">
    <div className="onsite-checkout__shell">
      <div className="onsite-checkout__header-region">{header}</div>
      <CheckoutSummary display={display} couponControl={couponControl} />
      <div className="onsite-checkout__main">{children}</div>
    </div>
  </div>
);

const CheckoutHeader = ({ onCancel, busy, paymentStage = false }) => (
  <>
    <button type="button" className="onsite-checkout__back" onClick={onCancel} disabled={busy}>
      <ArrowLeft size={17} aria-hidden="true" /> Späť a zrušiť pokladňu
    </button>
    <header className="onsite-checkout__header">
      <span className="onsite-checkout__eyebrow">Zajkológia pokladňa</span>
      <h1>{paymentStage ? 'Bezpečná platba' : 'Dokončite objednávku'}</h1>
      <p>{paymentStage ? 'Údaje sú uložené. Vyberte spôsob platby.' : 'Všetko vybavíte bezpečne priamo na zajkologia.com.'}</p>
    </header>
  </>
);

const CheckoutResult = ({ bootstrap, onRetry }) => {
  const state = bootstrap.attempt?.resultState;
  const success = state === 'success';
  const failed = state === 'failed';
  const display = bootstrap.display || {};
  const returnPath = display.returnPath || '/';
  const headingRef = useRef(null);

  useEffect(() => { headingRef.current?.focus(); }, [state]);

  return (
    <div className="onsite-checkout onsite-checkout--result">
      <section className="onsite-checkout__result" aria-live="polite">
        {success ? <CheckCircle2 size={44} aria-hidden="true" /> : failed ? <RefreshCw size={42} aria-hidden="true" /> : <Clock3 size={42} aria-hidden="true" />}
        <span className="onsite-checkout__eyebrow">Zajkológia pokladňa</span>
        <h1 ref={headingRef} tabIndex="-1">{success ? 'Platba je potvrdená' : failed ? 'Platba nebola dokončená' : 'Platbu bezpečne potvrdzujeme'}</h1>
        <p>
          {success
            ? display.kind === 'membership'
              ? 'Členstvo sprístupňujeme. Ak sa prístup ešte nezobrazil, obnovte stránku klubu o chvíľu.'
              : display.hasDigitalItems && display.hasPhysicalItems
                ? 'Digitálne produkty pošleme e-mailom a fyzické položky pripravíme na doručenie.'
                : display.hasDigitalItems
                  ? 'PDF vám pošleme bezpečným odkazom na zadaný e-mail.'
                  : 'Objednávku sme zaevidovali a pošleme vám potvrdenie e-mailom.'
            : failed
              ? 'Nič sme neoznačili ako zaplatené. Môžete sa vrátiť a vytvoriť nový bezpečný pokus.'
              : 'Čakáme na podpísaný Stripe webhook. Košík ani zľavu zatiaľ nemažeme a novú platbu nevytvárajte.'}
        </p>
        {!success && !failed ? <button type="button" className="onsite-checkout__secondary" onClick={onRetry}><RefreshCw size={17} aria-hidden="true" /> Overiť stav</button> : null}
        <Link className="onsite-checkout__primary-link" to={returnPath}>{display.kind === 'membership' ? 'Prejsť do klubu' : 'Späť na Zajkológiu'}</Link>
      </section>
    </div>
  );
};

const AddressFields = ({ idPrefix, value, onChange }) => {
  const update = (field, nextValue) => onChange({ ...value, [field]: nextValue });
  const updateAddress = (field, nextValue) => onChange({ ...value, address: { ...value.address, [field]: nextValue } });
  return (
    <div className="onsite-checkout__native-fields onsite-checkout__native-fields--grid">
      <label htmlFor={`${idPrefix}-name`}>Meno a priezvisko</label>
      <input id={`${idPrefix}-name`} name={`${idPrefix}-name`} value={value.name} onChange={(event) => update('name', event.target.value)} autoComplete="name" maxLength="255" required />
      <label htmlFor={`${idPrefix}-line1`}>Ulica a číslo</label>
      <input id={`${idPrefix}-line1`} name={`${idPrefix}-line1`} value={value.address.line1} onChange={(event) => updateAddress('line1', event.target.value)} autoComplete="address-line1" maxLength="255" required />
      <label htmlFor={`${idPrefix}-line2`}>Doplnenie adresy <span>(nepovinné)</span></label>
      <input id={`${idPrefix}-line2`} name={`${idPrefix}-line2`} value={value.address.line2} onChange={(event) => updateAddress('line2', event.target.value)} autoComplete="address-line2" maxLength="255" />
      <div className="onsite-checkout__field-pair">
        <div><label htmlFor={`${idPrefix}-city`}>Mesto</label><input id={`${idPrefix}-city`} name={`${idPrefix}-city`} value={value.address.city} onChange={(event) => updateAddress('city', event.target.value)} autoComplete="address-level2" maxLength="191" required /></div>
        <div><label htmlFor={`${idPrefix}-postal-code`}>PSČ</label><input id={`${idPrefix}-postal-code`} name={`${idPrefix}-postal-code`} value={value.address.postal_code} onChange={(event) => updateAddress('postal_code', event.target.value)} autoComplete="postal-code" maxLength="64" required /></div>
      </div>
      <label htmlFor={`${idPrefix}-country`}>Krajina (kód)</label>
      <input id={`${idPrefix}-country`} name={`${idPrefix}-country`} value={value.address.country} onChange={(event) => updateAddress('country', event.target.value.toUpperCase())} autoComplete="country" minLength="2" maxLength="2" pattern="[A-Za-z]{2}" required />
    </div>
  );
};

const CheckoutDetailsForm = ({
  bootstrap,
  attempt,
  couponBusy,
  isCouponMutationLocked,
  onApplyCoupon,
  onRemoveCoupon,
  onStateChange,
}) => {
  const navigate = useNavigate();
  const display = bootstrap.display;
  const hasPhysicalItems = Boolean(display.hasPhysicalItems);
  const isMembership = display.kind === 'membership';
  const configuredShippingCountries = display.shipping?.allowedCountries || [];
  const shippingCountries = (configuredShippingCountries.length ? configuredShippingCountries : ['SK'])
    .map((country) => String(country).toUpperCase());
  const [customer, setCustomer] = useState(() => getInitialCustomer(bootstrap));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const submissionLockRef = useRef(false);
  const errorRef = useRef(null);
  const focusErrorRef = useRef(true);
  const formRef = useRef(null);

  useEffect(() => {
    if (!error) return;
    if (focusErrorRef.current) errorRef.current?.focus();
    focusErrorRef.current = true;
  }, [error]);

  const handleCancel = async () => {
    if (busy || couponBusy || isCouponMutationLocked?.()) return;
    setBusy(true);
    setStatus('Uvoľňujeme rezerváciu…');
    try {
      await cancelCheckoutAttempt(attempt.id, attempt.token);
      clearCheckoutAttempt(attempt.id);
      navigate(display.returnPath || '/', { replace: true });
    } catch (cancelError) {
      setError(getErrorMessage(cancelError));
      setBusy(false);
      setStatus('');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy || couponBusy || isCouponMutationLocked?.() || submissionLockRef.current) return;
    focusErrorRef.current = true;
    setError('');
    if (!formRef.current?.checkValidity()) {
      focusErrorRef.current = false;
      setError('Vyplňte prosím všetky povinné údaje a potvrďte podmienky.');
      formRef.current?.querySelector(':invalid')?.focus();
      return;
    }
    submissionLockRef.current = true;
    setBusy(true);
    setStatus(hasPhysicalItems ? 'Ukladáme adresu Packeta/Z-BOXu a konečnú cenu…' : 'Ukladáme údaje a konečnú cenu…');
    try {
      const next = await saveCheckoutCustomer({
        attemptId: attempt.id,
        attemptToken: attempt.token,
        customer: {
          email: customer.email,
          billing: customer.billing,
          shipping: hasPhysicalItems ? customer.shipping : null,
          delivery: hasPhysicalItems ? customer.delivery : null,
          consent: { accepted: true, version: display.consent.version },
        },
      });
      onStateChange(next);
    } catch (saveError) {
      try {
        const resumed = await loadCheckoutAttempt(attempt.id, attempt.token);
        if (resumed?.stripe?.clientSecret && resumed?.attempt?.status === 'ready_to_confirm') {
          onStateChange(resumed);
          return;
        }
      } catch {
        // Preserve the original mutation error when the resume check also fails.
      }
      setError(getErrorMessage(saveError));
      setStatus('');
      setBusy(false);
      submissionLockRef.current = false;
    }
  };

  return (
    <CheckoutShell
      display={display}
      header={<CheckoutHeader onCancel={handleCancel} busy={busy || couponBusy} />}
      couponControl={isMembership ? null : (
        <CheckoutCouponPanel
          display={display}
          busy={couponBusy}
          disabled={busy}
          locked={false}
          onApply={onApplyCoupon}
          onRemove={onRemoveCoupon}
        />
      )}
    >
      <form ref={formRef} className="onsite-checkout__form" onSubmit={handleSubmit} noValidate>
        {error ? <div className="onsite-checkout__error" role="alert" tabIndex="-1" ref={errorRef}>{error}</div> : null}
        <p className="onsite-checkout__status" role="status" aria-live="polite">{status}</p>
        <section className="onsite-checkout__section" aria-labelledby="checkout-contact-title">
          <div className="onsite-checkout__section-title"><span>1</span><div><h2 id="checkout-contact-title">Kontakt</h2><p>Na tento e-mail pošleme potvrdenie a digitálne produkty.</p></div></div>
          {isMembership ? <div className="onsite-checkout__readonly"><span>Overený e-mail</span><strong>{customer.email}</strong></div> : (
            <div className="onsite-checkout__native-fields"><label htmlFor="checkout-email">E-mail</label><input id="checkout-email" name="email" type="email" value={customer.email} onChange={(event) => setCustomer((current) => ({ ...current, email: event.target.value }))} autoComplete="email" maxLength="320" required /></div>
          )}
        </section>
        <section className="onsite-checkout__section" aria-labelledby="checkout-billing-title">
          <div className="onsite-checkout__section-title"><span>2</span><div><h2 id="checkout-billing-title">Fakturačné údaje</h2><p>Meno a adresa držiteľa platby.</p></div></div>
          <AddressFields idPrefix="billing" value={customer.billing} onChange={(billing) => setCustomer((current) => ({ ...current, billing }))} />
          {!hasPhysicalItems ? <div className="onsite-checkout__native-fields"><label htmlFor="billing-phone">Telefón <span>(nepovinné)</span></label><input id="billing-phone" name="billing-phone" type="tel" value={customer.billing.phone} onChange={(event) => setCustomer((current) => ({ ...current, billing: { ...current.billing, phone: event.target.value } }))} autoComplete="tel" maxLength="64" /></div> : null}
        </section>
        {hasPhysicalItems ? (
          <section className="onsite-checkout__section" aria-labelledby="checkout-delivery-title">
            <div className="onsite-checkout__section-title"><span>3</span><div><h2 id="checkout-delivery-title">Doručenie</h2><p>Zadajte adresu zvoleného Packeta výdajného miesta alebo Z-BOXu.</p></div></div>
            <div className="onsite-checkout__delivery-notice" id="packeta-address-help">
              <strong>Dôležité: nezadávajte domácu adresu.</strong>
              <span>Do polí nižšie prepíšte presnú adresu vybraného Packeta výdajného miesta alebo Z-BOXu.</span>
            </div>
            <div className="onsite-checkout__native-fields">
              <label htmlFor="shipping-name">Meno príjemcu</label><input id="shipping-name" name="shipping-name" value={customer.shipping.name} onChange={(event) => setCustomer((current) => ({ ...current, shipping: { ...current.shipping, name: event.target.value } }))} autoComplete="shipping name" maxLength="255" required />
              <label htmlFor="shipping-phone">Telefón príjemcu</label><input id="shipping-phone" name="shipping-phone" type="tel" value={customer.shipping.phone} onChange={(event) => setCustomer((current) => ({ ...current, shipping: { ...current.shipping, phone: event.target.value } }))} autoComplete="shipping tel" maxLength="64" required />
              <label htmlFor="delivery-method">Typ výdajného miesta</label>
              <select id="delivery-method" name="delivery-method" value={customer.delivery?.method || ''} onChange={(event) => setCustomer((current) => ({ ...current, delivery: { ...(current.delivery || {}), method: event.target.value } }))} required>
                <option value="" disabled>Vyberte Packeta alebo Z-BOX</option>
                <option value="packeta">Packeta výdajné miesto</option>
                <option value="zbox">Z-BOX</option>
              </select>
              <label htmlFor="shipping-line1">Ulica a číslo Packeta/Z-BOXu</label><input id="shipping-line1" name="shipping-line1" value={customer.shipping.address.line1} onChange={(event) => setCustomer((current) => ({ ...current, shipping: { ...current.shipping, address: { ...current.shipping.address, line1: event.target.value } } }))} autoComplete="shipping address-line1" aria-describedby="packeta-address-help" maxLength="255" required />
              <label htmlFor="shipping-line2">Názov alebo označenie miesta <span>(nepovinné)</span></label><input id="shipping-line2" name="shipping-line2" value={customer.shipping.address.line2} onChange={(event) => setCustomer((current) => ({ ...current, shipping: { ...current.shipping, address: { ...current.shipping.address, line2: event.target.value } } }))} autoComplete="shipping address-line2" maxLength="255" />
              <div className="onsite-checkout__field-pair">
                <div><label htmlFor="shipping-city">Mesto Packeta/Z-BOXu</label><input id="shipping-city" name="shipping-city" value={customer.shipping.address.city} onChange={(event) => setCustomer((current) => ({ ...current, shipping: { ...current.shipping, address: { ...current.shipping.address, city: event.target.value } } }))} autoComplete="shipping address-level2" maxLength="191" required /></div>
                <div><label htmlFor="shipping-postal-code">PSČ Packeta/Z-BOXu</label><input id="shipping-postal-code" name="shipping-postal-code" value={customer.shipping.address.postal_code} onChange={(event) => setCustomer((current) => ({ ...current, shipping: { ...current.shipping, address: { ...current.shipping.address, postal_code: event.target.value } } }))} autoComplete="shipping postal-code" maxLength="64" required /></div>
              </div>
              <label htmlFor="shipping-country">Krajina doručenia</label>
              <select id="shipping-country" name="shipping-country" value={customer.shipping.address.country} onChange={(event) => setCustomer((current) => ({ ...current, shipping: { ...current.shipping, address: { ...current.shipping.address, country: event.target.value } } }))} autoComplete="shipping country" required>
                {shippingCountries.map((country) => <option key={country} value={country}>{COUNTRY_LABELS[country] || country} ({country})</option>)}
              </select>
              <label className="onsite-checkout__delivery-confirmation" htmlFor="delivery-address-confirmed">
                <input id="delivery-address-confirmed" name="delivery-address-confirmed" type="checkbox" checked={customer.delivery?.addressConfirmed === true} onChange={(event) => setCustomer((current) => ({ ...current, delivery: { ...(current.delivery || {}), addressConfirmed: event.target.checked } }))} required />
                <span>Áno, zadal/a som adresu vybraného Packeta výdajného miesta alebo Z-BOXu, nie svoju domácu adresu.</span>
              </label>
              <label htmlFor="delivery-instructions">Poznámka pre doručenie <span>(nepovinné)</span></label><textarea id="delivery-instructions" value={customer.delivery?.instructions || ''} onChange={(event) => setCustomer((current) => ({ ...current, delivery: { ...(current.delivery || {}), instructions: event.target.value } }))} maxLength="1000" rows="3" />
            </div>
          </section>
        ) : null}
        <section className="onsite-checkout__section" aria-labelledby="checkout-consent-title">
          <div className="onsite-checkout__section-title"><span>{hasPhysicalItems ? '4' : '3'}</span><div><h2 id="checkout-consent-title">Súhlas a podmienky</h2><p>Pred platbou si prečítajte presné znenie súhlasu.</p></div></div>
          <label className="onsite-checkout__consent"><input type="checkbox" checked={customer.consent.accepted} onChange={(event) => setCustomer((current) => ({ ...current, consent: { accepted: event.target.checked, version: display.consent.version } }))} required /><span>{display.consent.text}</span></label>
          <p className="onsite-checkout__legal-links">Pozrite si aj <Link to="/obchodne-podmienky" target="_blank" rel="noreferrer">obchodné podmienky</Link>.</p>
        </section>
        <button className="onsite-checkout__submit" type="submit" disabled={busy || couponBusy} aria-busy={busy || couponBusy}><LockKeyhole size={18} aria-hidden="true" />{busy ? 'Overujeme údaje…' : couponBusy ? 'Prepočítavame cenu…' : 'Pokračovať k bezpečnej platbe'}</button>
      </form>
    </CheckoutShell>
  );
};

const CheckoutPaymentForm = ({
  bootstrap,
  attempt,
  couponBusy,
  isCouponMutationLocked,
  onApplyCoupon,
  onRemoveCoupon,
  onStateChange,
}) => {
  const checkoutState = useCheckoutElements();
  const navigate = useNavigate();
  const display = bootstrap.display;
  const customer = bootstrap.customer;
  const hasPayment = Number(display.total || 0) > 0;
  const [paymentComplete, setPaymentComplete] = useState(!hasPayment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const submissionLockRef = useRef(false);
  const errorRef = useRef(null);
  const paymentElementRef = useRef(null);
  const providerError = checkoutState.type === 'error'
    ? checkoutState.error?.message || 'Bezpečný platobný formulár sa nepodarilo načítať. Obnovte stránku.'
    : '';
  const visibleError = error || providerError;

  useEffect(() => { if (visibleError) errorRef.current?.focus(); }, [visibleError]);

  const handleCancel = async () => {
    if (busy || couponBusy || isCouponMutationLocked?.() || submissionLockRef.current) return;
    setBusy(true);
    setStatus('Uvoľňujeme rezerváciu…');
    try {
      await cancelCheckoutAttempt(attempt.id, attempt.token);
      clearCheckoutAttempt(attempt.id);
      navigate(display.returnPath || '/', { replace: true });
    } catch (cancelError) {
      setError(getErrorMessage(cancelError));
      setBusy(false);
      setStatus('');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy || couponBusy || isCouponMutationLocked?.() || submissionLockRef.current) return;
    submissionLockRef.current = true;
    setError('');
    if (!paymentComplete) {
      setError('Vyberte a vyplňte platobnú metódu.');
      paymentElementRef.current?.focus();
      submissionLockRef.current = false;
      return;
    }
    if (checkoutState.type !== 'success') {
      setError('Platobný formulár sa ešte načítava. Skúste to o chvíľu.');
      submissionLockRef.current = false;
      return;
    }
    setBusy(true);
    setStatus('Kontrolujeme platobné údaje…');
    try {
      const validation = await checkoutState.checkout.validateElements();
      if (validation.type === 'error') {
        setError(validation.error?.message || 'Skontrolujte platobné údaje.');
        paymentElementRef.current?.focus();
        submissionLockRef.current = false;
        setBusy(false);
        setStatus('');
        return;
      }
      setStatus(hasPayment ? 'Odosielame platbu…' : 'Dokončujeme objednávku bez platby…');
      // The server already sets the trusted return_url on the Checkout Session.
      // Passing returnUrl again here makes Stripe reject the confirmation.
      const confirmation = await checkoutState.checkout.confirm({
        redirect: 'if_required',
        email: customer.email,
        billingAddress: { name: customer.billing.name, address: customer.billing.address },
        ...(display.hasPhysicalItems
          ? { shippingAddress: { name: customer.shipping.name, address: customer.shipping.address }, phoneNumber: customer.shipping.phone }
          : customer.billing.phone ? { phoneNumber: customer.billing.phone } : {}),
      });
      if (confirmation.type === 'error') {
        setError(getErrorMessage(confirmation.error));
        setStatus('');
        submissionLockRef.current = false;
        setBusy(false);
        return;
      }
      const processing = {
        ...bootstrap,
        attempt: { ...bootstrap.attempt, resultState: 'processing' },
        stripe: { sessionId: bootstrap.stripe.sessionId },
      };
      onStateChange(processing);
      try {
        const next = await loadCheckoutAttempt(attempt.id, attempt.token);
        onStateChange(next.attempt?.resultState === 'checkout' ? processing : next);
      } catch {
        // The result screen owns polling. Never reopen submission after confirm.
      }
    } catch (submitError) {
      setError(getErrorMessage(submitError));
      setStatus('');
      submissionLockRef.current = false;
      setBusy(false);
    }
  };

  return (
    <CheckoutShell
      display={display}
      header={<CheckoutHeader onCancel={handleCancel} busy={busy || couponBusy} paymentStage />}
      couponControl={display.kind === 'membership' ? null : (
        <CheckoutCouponPanel
          display={display}
          busy={couponBusy}
          disabled={busy}
          locked
          onApply={onApplyCoupon}
          onRemove={onRemoveCoupon}
        />
      )}
    >
      <form className="onsite-checkout__form" onSubmit={handleSubmit} noValidate>
        {visibleError ? <div className="onsite-checkout__error" role="alert" tabIndex="-1" ref={errorRef}>{visibleError}</div> : null}
        <p className="onsite-checkout__status" role="status" aria-live="polite">{status}</p>
        <section className="onsite-checkout__section" aria-labelledby="checkout-saved-title">
          <div className="onsite-checkout__section-title"><span><CheckCircle2 size={16} aria-hidden="true" /></span><div><h2 id="checkout-saved-title">Údaje a súhlas sú uložené</h2><p>{customer.email}</p></div></div>
          <p className="onsite-checkout__field-help">Kvôli bezpečnosti ich po otvorení platby nemožno meniť. Ak potrebujete opravu, zrušte tento pokus a začnite znova.</p>
        </section>
        <section className="onsite-checkout__section" aria-labelledby="checkout-payment-title">
          <div className="onsite-checkout__section-title"><span>2</span><div><h2 id="checkout-payment-title">Platba</h2><p>{hasPayment ? 'Vyberte si dostupnú platobnú metódu.' : 'Zľava pokryla celú sumu; platobná karta nie je potrebná.'}</p></div></div>
          {hasPayment ? <PaymentElement options={PAYMENT_ELEMENT_OPTIONS} onReady={(element) => { paymentElementRef.current = element; }} onChange={(event) => setPaymentComplete(event.complete)} /> : <div className="onsite-checkout__free"><CheckCircle2 aria-hidden="true" /> Objednávka nevyžaduje platbu.</div>}
        </section>
        <button className="onsite-checkout__submit" type="submit" disabled={busy || couponBusy || checkoutState.type !== 'success'} aria-busy={busy || couponBusy}><LockKeyhole size={18} aria-hidden="true" />{busy ? 'Spracúvame…' : hasPayment ? `Zaplatiť ${formatMoney(display.total, display.currency)}` : 'Dokončiť objednávku'}</button>
        <p className="onsite-checkout__submit-note">Platobné údaje idú priamo do Stripe. Ak banka vyžaduje overenie, bezpečne vás vrátime na túto pokladňu.</p>
      </form>
    </CheckoutShell>
  );
};

export const CheckoutPaymentStage = ({
  bootstrap,
  attempt,
  couponBusy = false,
  isCouponMutationLocked,
  elementsOptions,
  onApplyCoupon,
  onRemoveCoupon,
  onStateChange,
}) => {
  const sessionKey = `${bootstrap.stripe.sessionId || ''}:${bootstrap.stripe.clientSecret || ''}`;
  return (
    <CheckoutElementsProvider
      key={sessionKey}
      stripe={getStripePromise(bootstrap.stripe.publishableKey)}
      options={elementsOptions}
    >
      <CheckoutPaymentForm
        bootstrap={bootstrap}
        attempt={attempt}
        couponBusy={couponBusy}
        isCouponMutationLocked={isCouponMutationLocked}
        onApplyCoupon={onApplyCoupon}
        onRemoveCoupon={onRemoveCoupon}
        onStateChange={onStateChange}
      />
    </CheckoutElementsProvider>
  );
};

const CheckoutPage = () => {
  const { attemptId: routeAttemptId } = useParams();
  const [searchParams] = useSearchParams();
  const attemptId = String(routeAttemptId || searchParams.get('attempt_id') || '').trim().toLowerCase();
  const isReturn = !routeAttemptId;
  const { applyCoupon, clearCart, coupon, removeCoupon } = useCart();
  const [attempt] = useState(() => getCheckoutAttempt(attemptId));
  const [bootstrap, setBootstrap] = useState(null);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const successHandledRef = useRef(false);
  const paymentSubmittedRef = useRef(false);
  const couponMutationLockRef = useRef(false);
  const attemptToken = attempt?.token || '';

  const applyCheckoutState = useCallback((data) => {
    const nextResultState = data?.attempt?.resultState;
    if (
      paymentSubmittedRef.current &&
      (!nextResultState || nextResultState === 'checkout')
    ) {
      return false;
    }
    if (nextResultState === 'processing') paymentSubmittedRef.current = true;
    setBootstrap(data);
    return true;
  }, []);

  const loadAuthoritativeState = useCallback(async () => {
    if (!attemptToken) { setLoadState('missing'); return null; }
    try {
      const data = isReturn ? await recordCheckoutReturn(attemptId, attemptToken) : await loadCheckoutAttempt(attemptId, attemptToken);
      applyCheckoutState(data);
      setLoadState('loaded');
      return data;
    } catch (error) {
      setLoadError(getErrorMessage(error));
      setLoadState('error');
      return null;
    }
  }, [applyCheckoutState, attemptId, attemptToken, isReturn]);

  const mutateCoupon = useCallback(async ({ action, couponCode = '' }) => {
    if (couponMutationLockRef.current) {
      throw new Error('checkout_attempt_busy');
    }
    if (!attemptToken || bootstrap?.attempt?.status !== 'open') {
      throw new Error('checkout_coupon_locked_for_payment');
    }
    couponMutationLockRef.current = true;
    setCouponBusy(true);
    try {
      const normalizedCode = normalizeCouponCode(couponCode);
      const matchingClaimToken = action === 'apply' &&
        normalizedCode === normalizeCouponCode(coupon?.code)
        ? coupon?.claimToken || ''
        : '';
      const descriptor = {
        action,
        couponCode: action === 'apply' ? normalizedCode : '',
      };
      const pendingMutation = getPendingCheckoutCouponMutation(attemptId);
      if (
        pendingMutation &&
        (
          pendingMutation.action !== descriptor.action ||
          pendingMutation.couponCode !== descriptor.couponCode
        )
      ) {
        throw new Error('checkout_coupon_mutation_pending');
      }
      const mutationId = pendingMutation?.mutationId || window.crypto.randomUUID();
      if (!pendingMutation) {
        storePendingCheckoutCouponMutation(attemptId, { ...descriptor, mutationId });
      }
      const next = await mutateCheckoutAttemptCoupon({
        attemptId,
        attemptToken,
        action,
        couponCode: normalizedCode,
        claimToken: matchingClaimToken,
        mutationId,
      });
      if (!next?.display || next.attempt?.status !== 'open') {
        throw new Error('checkout_coupon_response_invalid');
      }
      clearPendingCheckoutCouponMutation(attemptId);
      applyCheckoutState(next);
      if (action === 'remove' || !next.display.coupon) {
        removeCoupon();
      } else {
        const isWelcome = next.display.coupon.kind === 'welcome';
        applyCoupon({
          code: next.display.coupon.code,
          ...(isWelcome && matchingClaimToken ? { claimToken: matchingClaimToken } : {}),
          source: isWelcome ? 'welcome' : 'manual',
        });
      }
      return next;
    } catch (error) {
      if (error?.status && error.status !== 503) {
        clearPendingCheckoutCouponMutation(attemptId);
      }
      throw error;
    } finally {
      couponMutationLockRef.current = false;
      setCouponBusy(false);
    }
  }, [
    applyCheckoutState,
    applyCoupon,
    attemptId,
    attemptToken,
    bootstrap?.attempt?.status,
    coupon,
    removeCoupon,
  ]);

  const handleApplyCoupon = useCallback(
    (couponCode) => mutateCoupon({ action: 'apply', couponCode }),
    [mutateCoupon]
  );
  const handleRemoveCoupon = useCallback(
    () => mutateCoupon({ action: 'remove' }),
    [mutateCoupon]
  );
  const isCouponMutationLocked = useCallback(
    () => couponMutationLockRef.current,
    []
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => { if (!cancelled) await loadAuthoritativeState(); };
    load();
    return () => { cancelled = true; };
  }, [loadAuthoritativeState]);

  const resultState = bootstrap?.attempt?.resultState;
  const checkoutKind = bootstrap?.attempt?.kind;

  useEffect(() => {
    if (!bootstrap?.display || bootstrap.display.kind === 'membership' || resultState) return;
    const serverCoupon = bootstrap.display.coupon || null;
    const pendingMutation = getPendingCheckoutCouponMutation(attemptId);
    if (
      (pendingMutation?.action === 'remove' && !serverCoupon) ||
      (
        pendingMutation?.action === 'apply' &&
        normalizeCouponCode(pendingMutation.couponCode) === normalizeCouponCode(serverCoupon?.code)
      )
    ) {
      clearPendingCheckoutCouponMutation(attemptId);
    }
    if (!serverCoupon) {
      if (coupon) removeCoupon();
      return;
    }
    const currentCode = normalizeCouponCode(coupon?.code);
    const serverCode = normalizeCouponCode(serverCoupon.code);
    const isWelcome = serverCoupon.kind === 'welcome';
    const matchingClaimToken = currentCode === serverCode ? coupon?.claimToken || '' : '';
    if (isWelcome && !matchingClaimToken) return;
    const source = isWelcome ? 'welcome' : 'manual';
    if (
      currentCode === serverCode &&
      coupon?.source === source &&
      String(coupon?.claimToken || '') === String(matchingClaimToken)
    ) {
      return;
    }
    applyCoupon({
      code: serverCoupon.code,
      ...(matchingClaimToken ? { claimToken: matchingClaimToken } : {}),
      source,
    });
  }, [applyCoupon, attemptId, bootstrap?.display, coupon, removeCoupon, resultState]);
  useEffect(() => {
    if (resultState !== 'processing') return undefined;
    let cancelled = false;
    const poll = async () => {
      for (let index = 0; index < PROCESSING_MAX_POLLS; index += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, PROCESSING_POLL_MS));
        if (cancelled) return;
        const next = await loadCheckoutAttempt(attemptId, attemptToken).catch(() => null);
        if (!next) continue;
        const applied = applyCheckoutState(next);
        if (!applied) continue;
        if (next.attempt?.resultState !== 'processing') return;
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [applyCheckoutState, attemptId, attemptToken, resultState]);

  useEffect(() => {
    if (resultState !== 'success' || successHandledRef.current) return;
    successHandledRef.current = true;
    if (checkoutKind === 'cart') clearCart();
    if (checkoutKind !== 'membership') {
      removeCoupon();
      clearStoredWelcomeDiscountOffer();
      suppressEmailCaptureOffers('purchased');
    }
    clearCheckoutAttempt(attemptId);
  }, [attemptId, checkoutKind, clearCart, removeCoupon, resultState]);

  useEffect(() => { if (resultState === 'failed') clearCheckoutAttempt(attemptId); }, [attemptId, resultState]);

  const elementsOptions = useMemo(() => ({
    clientSecret: bootstrap?.stripe?.clientSecret || '',
    elementsOptions: {
      loader: 'auto',
      appearance: {
        theme: 'stripe',
        variables: { colorPrimary: '#7d4f58', colorText: '#260c1a', colorDanger: '#9f2438', borderRadius: '10px', fontFamily: 'Inter, system-ui, sans-serif', spacingUnit: '4px' },
        rules: { '.Input': { border: '1px solid #ccb8bc', boxShadow: 'none' }, '.Input:focus': { border: '2px solid #7d4f58', boxShadow: '0 0 0 3px rgba(125,79,88,.18)' }, '.Label': { fontWeight: '600' } },
      },
    },
  }), [bootstrap?.stripe?.clientSecret]);

  if (loadState === 'loading') return <div className="onsite-checkout onsite-checkout--loading" role="status"><Clock3 aria-hidden="true" /><h1>Načítavame bezpečnú pokladňu…</h1><p>Overujeme cenu, rezervácie a zľavu.</p></div>;
  if (loadState === 'missing') return <div className="onsite-checkout onsite-checkout--loading" role="alert"><LockKeyhole aria-hidden="true" /><h1>Pokladňu nemožno bezpečne obnoviť</h1><p>Otvorili ste ju v inom prehliadači alebo súkromná relácia skončila. Vráťte sa k produktu a vytvorte nový pokus.</p><Link to="/">Späť na Zajkológiu</Link></div>;
  if (loadState === 'error' || !bootstrap) return <div className="onsite-checkout onsite-checkout--loading" role="alert"><RefreshCw aria-hidden="true" /><h1>Pokladňu sa nepodarilo načítať</h1><p>{loadError}</p><button type="button" onClick={loadAuthoritativeState}>Skúsiť znova</button></div>;
  if (resultState && resultState !== 'checkout') return <CheckoutResult bootstrap={bootstrap} onRetry={loadAuthoritativeState} />;
  if (!bootstrap.stripe?.clientSecret) {
    return (
      <CheckoutDetailsForm
        bootstrap={bootstrap}
        attempt={attempt}
        couponBusy={couponBusy}
        isCouponMutationLocked={isCouponMutationLocked}
        onApplyCoupon={handleApplyCoupon}
        onRemoveCoupon={handleRemoveCoupon}
        onStateChange={applyCheckoutState}
      />
    );
  }
  return (
    <CheckoutPaymentStage
      bootstrap={bootstrap}
      attempt={attempt}
      couponBusy={couponBusy}
      isCouponMutationLocked={isCouponMutationLocked}
      elementsOptions={elementsOptions}
      onApplyCoupon={handleApplyCoupon}
      onRemoveCoupon={handleRemoveCoupon}
      onStateChange={applyCheckoutState}
    />
  );
};

export default CheckoutPage;
