import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelCheckoutAttempt,
  loadCheckoutAttempt,
  mutateCheckoutAttemptCoupon,
  recordCheckoutReturn,
  saveCheckoutCustomer,
} from '../api/client';
import { CartProvider } from '../cart/CartContext';
import CheckoutPage, { CheckoutPaymentStage } from './CheckoutPage';

const stripeActions = vi.hoisted(() => ({
  validateElements: vi.fn(),
  confirm: vi.fn(),
}));
const stripeHook = vi.hoisted(() => ({ type: 'success', error: null }));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(async () => ({ mocked: true })),
}));

vi.mock('@stripe/react-stripe-js/checkout', () => ({
  CheckoutElementsProvider: ({ children, options }) => (
    <div data-testid="checkout-provider" data-client-secret={options?.clientSecret}>{children}</div>
  ),
  useCheckoutElements: () => ({ ...stripeHook, checkout: stripeActions }),
  PaymentElement: ({ onChange, onReady }) => (
    <button type="button" data-testid="payment-element" onClick={() => {
      onReady?.({ focus: vi.fn() });
      onChange?.({ complete: true });
    }}>Complete payment</button>
  ),
}));

vi.mock('../api/client', () => ({
  cancelCheckoutAttempt: vi.fn(),
  loadCheckoutAttempt: vi.fn(),
  mutateCheckoutAttemptCoupon: vi.fn(),
  recordCheckoutReturn: vi.fn(),
  saveCheckoutCustomer: vi.fn(),
}));

const ATTEMPT_ID = '123e4567-e89b-42d3-a456-426614174000';
const ATTEMPT_TOKEN = 'browser-owned-attempt-token-1234567890';
const MUTATION_ID = '323e4567-e89b-42d3-a456-426614174000';

const display = {
  kind: 'single',
  hasDigitalItems: true,
  hasPhysicalItems: false,
  items: [{ productSlug: 'guide', name: 'Príručka', quantity: 1, unitAmount: 499, netAmount: 399, discountAmount: 100, currency: 'eur' }],
  subtotal: 499,
  discountAmount: 100,
  shipping: { amount: 0, allowedCountries: [] },
  total: 399,
  currency: 'eur',
  coupon: { code: 'SAVE20', discountAmount: 100 },
  consent: { version: 'digital-v1', text: 'Súhlasím s okamžitým dodaním digitálneho obsahu.' },
  returnPath: '/product/guide',
};

const physicalDisplay = {
  ...display,
  hasDigitalItems: false,
  hasPhysicalItems: true,
  total: 599,
  shipping: {
    amount: 100,
    allowedCountries: ['SK', 'CZ'],
    label: 'Packeta / Z-BOX',
    addressEntry: 'manual_packeta',
  },
  consent: { version: 'physical-v1', text: 'Súhlasím s podmienkami fyzickej objednávky.' },
};

const noCouponDisplay = {
  ...display,
  items: display.items.map((item) => ({
    ...item,
    netAmount: item.unitAmount * item.quantity,
    discountAmount: 0,
  })),
  discountAmount: 0,
  total: 499,
  coupon: null,
};

const draftBootstrap = {
  ok: true,
  checkoutMode: 'elements',
  checkoutPageUrl: `/checkout/${ATTEMPT_ID}`,
  attempt: { id: ATTEMPT_ID, kind: 'single', status: 'open' },
  stripe: null,
  display,
};

const customer = {
  email: 'buyer@example.com',
  billing: {
    name: 'Buyer Rabbit',
    phone: '',
    address: {
      line1: 'Hlavná 1',
      line2: '',
      city: 'Bratislava',
      state: '',
      postal_code: '81101',
      country: 'SK',
    },
  },
  shipping: null,
  delivery: null,
  consent: { accepted: true, version: 'digital-v1' },
};

const readyBootstrap = {
  ...draftBootstrap,
  attempt: { ...draftBootstrap.attempt, status: 'ready_to_confirm' },
  customer,
  stripe: {
    publishableKey: 'pk_test_example',
    clientSecret: 'cs_test_example_secret_memory',
    sessionId: 'cs_test_example',
    returnUrl: `https://zajkologia.com/checkout/return?session_id=cs_test_example&attempt_id=${ATTEMPT_ID}`,
  },
};

const renderCheckout = (route = `/checkout/${ATTEMPT_ID}`) => render(
  <CartProvider>
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/checkout/:attemptId" element={<CheckoutPage />} />
        <Route path="/checkout/return" element={<CheckoutPage />} />
      </Routes>
    </MemoryRouter>
  </CartProvider>
);

const fillBillingDetails = async ({ email = true } = {}) => {
  if (email) await userEvent.type(screen.getByLabelText(/^e-mail$/i), 'buyer@example.com');
  await userEvent.type(screen.getByLabelText(/meno a priezvisko/i), 'Buyer Rabbit');
  await userEvent.type(screen.getByLabelText(/^ulica a číslo$/i), 'Hlavná 1');
  await userEvent.type(screen.getByLabelText(/^mesto$/i), 'Bratislava');
  await userEvent.type(screen.getByLabelText(/^psč$/i), '81101');
};

const fillManualPacketaAddress = async () => {
  await userEvent.type(screen.getByLabelText(/meno príjemcu/i), 'Buyer Rabbit');
  await userEvent.type(screen.getByLabelText(/telefón príjemcu/i), '+421900000000');
  await userEvent.selectOptions(screen.getByLabelText(/typ výdajného miesta/i), 'zbox');
  await userEvent.type(screen.getByLabelText(/ulica a číslo Packeta/i), 'Hlavná 10');
  await userEvent.type(screen.getByLabelText(/názov alebo označenie miesta/i), 'Z-BOX Bratislava');
  await userEvent.type(screen.getByLabelText(/mesto Packeta/i), 'Bratislava');
  await userEvent.type(screen.getByLabelText(/PSČ Packeta/i), '81101');
  await userEvent.selectOptions(screen.getByLabelText(/krajina doručenia/i), 'SK');
  await userEvent.type(screen.getByLabelText(/poznámka pre doručenie/i), 'Volajte po príchode.');
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.sessionStorage.setItem(
    `zajkologia_checkout_attempt_v2:${ATTEMPT_ID}`,
    JSON.stringify({
      id: ATTEMPT_ID,
      token: ATTEMPT_TOKEN,
      contractVersion: '2',
      kind: 'single',
      scope: 'single:guide',
      createdAt: Date.now(),
      createdOnServer: true,
    })
  );
  vi.mocked(loadCheckoutAttempt).mockResolvedValue(draftBootstrap);
  vi.mocked(recordCheckoutReturn).mockResolvedValue(draftBootstrap);
  vi.mocked(saveCheckoutCustomer).mockResolvedValue(readyBootstrap);
  vi.mocked(mutateCheckoutAttemptCoupon).mockResolvedValue(draftBootstrap);
  vi.mocked(cancelCheckoutAttempt).mockResolvedValue({ ok: true });
  vi.spyOn(window.crypto, 'randomUUID').mockReturnValue(MUTATION_ID);
  stripeActions.validateElements.mockResolvedValue({ type: 'success' });
  stripeActions.confirm.mockResolvedValue({ type: 'success', session: { status: 'complete' } });
  stripeHook.type = 'success';
  stripeHook.error = null;
});

describe('first-party Checkout Elements page', () => {
  it('applies a manual coupon in checkout, updates authoritative totals, and preserves typed details', async () => {
    const initial = { ...draftBootstrap, display: noCouponDisplay };
    const discounted = {
      ...initial,
      display: {
        ...display,
        coupon: {
          code: 'SAVE20',
          name: 'Jarná zľava',
          kind: 'manual',
          discountAmount: 100,
        },
      },
    };
    vi.mocked(loadCheckoutAttempt).mockResolvedValue(initial);
    vi.mocked(mutateCheckoutAttemptCoupon).mockResolvedValue(discounted);
    renderCheckout();

    const email = await screen.findByLabelText(/^e-mail$/i);
    await userEvent.type(email, 'typed@example.com');
    const couponInput = screen.getByRole('textbox', { name: /^zľavový kód$/i });
    await userEvent.type(couponInput, ' save 20 {enter}');

    await waitFor(() => expect(mutateCheckoutAttemptCoupon).toHaveBeenCalledOnce());
    expect(mutateCheckoutAttemptCoupon).toHaveBeenCalledWith({
      attemptId: ATTEMPT_ID,
      attemptToken: ATTEMPT_TOKEN,
      action: 'apply',
      couponCode: 'SAVE20',
      claimToken: '',
      mutationId: MUTATION_ID,
    });
    expect(screen.getByText(/Jarná zľava/i)).toBeInTheDocument();
    expect(screen.getByText(/Kód SAVE20 · úspora 1,00/i)).toBeInTheDocument();
    expect(screen.getByText(/Kód SAVE20 je použitý. Ušetríte 1,00/i)).toHaveAttribute('role', 'status');
    expect(email).toHaveValue('typed@example.com');
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('zajkologia_cart_v2'));
      expect(stored.coupon).toMatchObject({ code: 'SAVE20', source: 'manual' });
    });
  });

  it('preserves typed Packeta and consent data while a physical checkout is repriced', async () => {
    const physicalNoCoupon = {
      ...physicalDisplay,
      items: physicalDisplay.items.map((item) => ({
        ...item,
        discountAmount: 0,
        netAmount: item.unitAmount * item.quantity,
      })),
      discountAmount: 0,
      total: 599,
      coupon: null,
    };
    const physicalDiscounted = {
      ...draftBootstrap,
      display: {
        ...physicalDisplay,
        total: 499,
        coupon: { code: 'SAVE20', name: 'Jarná zľava', kind: 'manual', discountAmount: 100 },
      },
    };
    vi.mocked(loadCheckoutAttempt).mockResolvedValue({
      ...draftBootstrap,
      display: physicalNoCoupon,
    });
    vi.mocked(mutateCheckoutAttemptCoupon).mockResolvedValue(physicalDiscounted);
    renderCheckout();

    const packetaAddress = await screen.findByLabelText(/ulica a číslo Packeta/i);
    const instructions = screen.getByLabelText(/poznámka pre doručenie/i);
    const consent = screen.getByLabelText(/súhlasím s podmienkami fyzickej objednávky/i);
    await userEvent.type(packetaAddress, 'Packeta Hlavná 10');
    await userEvent.type(instructions, 'Kód na box 1234');
    await userEvent.click(consent);
    await userEvent.type(
      screen.getByRole('textbox', { name: /^zľavový kód$/i }),
      'SAVE20{enter}'
    );

    await screen.findByText(/Kód SAVE20 · úspora/i);
    expect(packetaAddress).toHaveValue('Packeta Hlavná 10');
    expect(instructions).toHaveValue('Kód na box 1234');
    expect(consent).toBeChecked();
  });

  it('removes an inherited coupon only after the server succeeds and returns focus to entry', async () => {
    const withoutCoupon = { ...draftBootstrap, display: noCouponDisplay };
    vi.mocked(mutateCheckoutAttemptCoupon).mockResolvedValue(withoutCoupon);
    renderCheckout();

    await userEvent.click(await screen.findByRole('button', { name: /odstrániť zľavový kód SAVE20/i }));
    await waitFor(() => expect(mutateCheckoutAttemptCoupon).toHaveBeenCalledWith(expect.objectContaining({
      action: 'remove',
      mutationId: MUTATION_ID,
    })));
    const couponInput = await screen.findByRole('textbox', { name: /^zľavový kód$/i });
    await waitFor(() => expect(couponInput).toHaveFocus());
    expect(screen.getByText(/zľavový kód bol odstránený/i)).toHaveAttribute('role', 'status');
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('zajkologia_cart_v2'));
      expect(stored.coupon).toBeNull();
    });
  });

  it('replaces an applied coupon explicitly and keeps the new server totals', async () => {
    const replaced = {
      ...draftBootstrap,
      display: {
        ...display,
        items: display.items.map((item) => ({ ...item, discountAmount: 200, netAmount: 299 })),
        discountAmount: 200,
        total: 299,
        coupon: {
          code: 'NEW40',
          name: 'Vernostná zľava',
          kind: 'manual',
          discountAmount: 200,
        },
      },
    };
    vi.mocked(mutateCheckoutAttemptCoupon).mockResolvedValue(replaced);
    renderCheckout();

    await userEvent.click(await screen.findByRole('button', { name: /použiť iný kód/i }));
    const input = screen.getByRole('textbox', { name: /nový zľavový kód/i });
    await userEvent.type(input, 'new40{enter}');

    await waitFor(() => expect(mutateCheckoutAttemptCoupon).toHaveBeenCalledWith(expect.objectContaining({
      action: 'apply',
      couponCode: 'NEW40',
    })));
    expect(screen.getByText(/Vernostná zľava/i)).toBeInTheDocument();
    expect(screen.getByText(/Kód NEW40 · úspora 2,00/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /zaplatiť/i })).not.toBeInTheDocument();
  });

  it('keeps the prior shared coupon and focuses a precise server error after failed replacement', async () => {
    window.localStorage.setItem('zajkologia_cart_v2', JSON.stringify({
      version: 2,
      items: [],
      coupon: { code: 'SAVE20', source: 'manual' },
    }));
    const failure = Object.assign(new Error('coupon_not_valid_for_product'), {
      data: { error: 'coupon_not_valid_for_product' },
    });
    vi.mocked(mutateCheckoutAttemptCoupon).mockRejectedValue(failure);
    renderCheckout();

    await userEvent.click(await screen.findByRole('button', { name: /použiť iný kód/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /nový zľavový kód/i }), 'wrong{enter}');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/neplatí na žiadny produkt/i);
    expect(alert).toHaveFocus();
    const stored = JSON.parse(window.localStorage.getItem('zajkologia_cart_v2'));
    expect(stored.coupon).toMatchObject({ code: 'SAVE20' });
    expect(screen.getByText(/Kód SAVE20 · úspora/i)).toBeInTheDocument();
  });

  it('keeps the shared coupon when checkout-side removal fails', async () => {
    window.localStorage.setItem('zajkologia_cart_v2', JSON.stringify({
      version: 2,
      items: [],
      coupon: { code: 'SAVE20', source: 'manual' },
    }));
    vi.mocked(mutateCheckoutAttemptCoupon).mockRejectedValue(
      Object.assign(new Error('checkout_coupon_session_replacement_failed'), {
        data: { error: 'checkout_coupon_session_replacement_failed' },
      })
    );
    renderCheckout();

    await userEvent.click(await screen.findByRole('button', {
      name: /odstrániť zľavový kód SAVE20/i,
    }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/pôvodná cena zostala nezmenená/i);
    const stored = JSON.parse(window.localStorage.getItem('zajkologia_cart_v2'));
    expect(stored.coupon).toMatchObject({ code: 'SAVE20' });
    expect(screen.getByText(/Kód SAVE20 · úspora/i)).toBeInTheDocument();
  });

  it('prevents a double coupon mutation and blocks checkout continuation while recalculating', async () => {
    const initial = { ...draftBootstrap, display: noCouponDisplay };
    const discounted = {
      ...draftBootstrap,
      display: { ...display, coupon: { ...display.coupon, kind: 'manual' } },
    };
    let finishMutation;
    vi.mocked(loadCheckoutAttempt).mockResolvedValue(initial);
    vi.mocked(mutateCheckoutAttemptCoupon).mockImplementation(() => new Promise((resolve) => {
      finishMutation = resolve;
    }));
    renderCheckout();

    const input = await screen.findByRole('textbox', { name: /^zľavový kód$/i });
    fireEvent.change(input, { target: { value: 'SAVE20' } });
    const applyButton = screen.getByRole('button', { name: /^použiť$/i });
    fireEvent.click(applyButton);
    fireEvent.click(applyButton);

    await waitFor(() => expect(mutateCheckoutAttemptCoupon).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /prepočítavame cenu/i })).toBeDisabled();
    finishMutation(discounted);
    await screen.findByText(/Kód SAVE20 · úspora/i);
  });

  it('reuses the persisted mutation identifier after an ambiguous network response', async () => {
    const initial = { ...draftBootstrap, display: noCouponDisplay };
    const discounted = {
      ...draftBootstrap,
      display: { ...display, coupon: { ...display.coupon, kind: 'manual' } },
    };
    vi.mocked(loadCheckoutAttempt).mockResolvedValue(initial);
    vi.mocked(mutateCheckoutAttemptCoupon)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(discounted);
    renderCheckout();

    const input = await screen.findByRole('textbox', { name: /^zľavový kód$/i });
    await userEvent.type(input, 'SAVE20');
    await userEvent.click(screen.getByRole('button', { name: /^použiť$/i }));
    await screen.findByRole('alert');
    const pendingKey = `zajkologia_checkout_coupon_mutation_v2:${ATTEMPT_ID}`;
    expect(JSON.parse(window.sessionStorage.getItem(pendingKey))).toEqual({
      action: 'apply',
      couponCode: 'SAVE20',
      mutationId: MUTATION_ID,
    });

    await userEvent.click(screen.getByRole('button', { name: /^použiť$/i }));
    await screen.findByText(/Kód SAVE20 · úspora/i);

    expect(mutateCheckoutAttemptCoupon).toHaveBeenCalledTimes(2);
    expect(mutateCheckoutAttemptCoupon.mock.calls[0][0].mutationId).toBe(MUTATION_ID);
    expect(mutateCheckoutAttemptCoupon.mock.calls[1][0].mutationId).toBe(MUTATION_ID);
    expect(window.sessionStorage.getItem(pendingKey)).toBeNull();
  });

  it('withholds Stripe UI until canonical details and consent are saved', async () => {
    renderCheckout();

    expect(await screen.findByRole('heading', { name: /dokončite objednávku/i })).toBeInTheDocument();
    expect(screen.getByText(/kód SAVE20 · úspora/i)).toBeInTheDocument();
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument();
    await fillBillingDetails();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /pokračovať k bezpečnej platbe/i }));

    await waitFor(() => expect(saveCheckoutCustomer).toHaveBeenCalledTimes(1));
    expect(saveCheckoutCustomer).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: ATTEMPT_ID,
      attemptToken: ATTEMPT_TOKEN,
      customer: expect.objectContaining({
        email: 'buyer@example.com',
        consent: { accepted: true, version: 'digital-v1' },
      }),
    }));
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
    expect(stripeActions.confirm).not.toHaveBeenCalled();
  });

  it('uses the Session return URL and passes canonical details to Stripe confirm', async () => {
    vi.mocked(loadCheckoutAttempt).mockResolvedValue(readyBootstrap);
    renderCheckout();
    await userEvent.click(await screen.findByTestId('payment-element'));
    await userEvent.click(screen.getByRole('button', { name: /zaplatiť 3,99/i }));

    await waitFor(() => expect(stripeActions.confirm).toHaveBeenCalledOnce());
    expect(stripeActions.confirm).toHaveBeenCalledWith(expect.objectContaining({
      redirect: 'if_required',
      email: 'buyer@example.com',
      billingAddress: expect.objectContaining({ name: 'Buyer Rabbit' }),
    }));
    const confirmInput = stripeActions.confirm.mock.calls[0][0];
    expect(confirmInput).not.toHaveProperty('returnUrl');
    expect(confirmInput.billingAddress).not.toHaveProperty('phone');
    expect(saveCheckoutCustomer).not.toHaveBeenCalled();
  });

  it('recovers an already-finalized bootstrap after a lost details response', async () => {
    vi.mocked(loadCheckoutAttempt)
      .mockResolvedValueOnce(draftBootstrap)
      .mockResolvedValueOnce(readyBootstrap);
    vi.mocked(saveCheckoutCustomer).mockRejectedValue(new Error('network_down'));
    renderCheckout();
    await screen.findByRole('heading', { name: /dokončite objednávku/i });
    await fillBillingDetails();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /pokračovať/i }));

    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses a synchronous submission lock to prevent duplicate confirmation', async () => {
    vi.mocked(loadCheckoutAttempt).mockResolvedValue(readyBootstrap);
    let finishConfirmation;
    stripeActions.confirm.mockImplementation(() => new Promise((resolve) => { finishConfirmation = resolve; }));
    renderCheckout();
    await userEvent.click(await screen.findByTestId('payment-element'));
    const submit = screen.getByRole('button', { name: /zaplatiť 3,99/i });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(stripeActions.confirm).toHaveBeenCalledTimes(1));
    finishConfirmation({ type: 'success', session: { status: 'complete' } });
  });

  it('never reopens payment when the first status request fails after successful confirm', async () => {
    vi.mocked(loadCheckoutAttempt)
      .mockResolvedValueOnce(readyBootstrap)
      .mockRejectedValueOnce(new Error('network_down'));
    renderCheckout();
    await userEvent.click(await screen.findByTestId('payment-element'));
    await userEvent.click(screen.getByRole('button', { name: /zaplatiť/i }));

    const heading = await screen.findByRole('heading', { name: /platbu bezpečne potvrdzujeme/i });
    expect(heading).toHaveFocus();
    expect(screen.queryByRole('button', { name: /zaplatiť/i })).not.toBeInTheDocument();
  });

  it('saves the manually entered Packeta address and explicit address confirmation', async () => {
    vi.mocked(loadCheckoutAttempt).mockResolvedValue({ ...draftBootstrap, display: physicalDisplay });
    vi.mocked(saveCheckoutCustomer).mockResolvedValue({
      ...readyBootstrap,
      display: physicalDisplay,
      customer: {
        ...customer,
        shipping: {
          name: 'Buyer Rabbit',
          phone: '+421900000000',
          address: {
            line1: 'Hlavná 10',
            line2: 'Z-BOX Bratislava',
            city: 'Bratislava',
            state: '',
            postal_code: '81101',
            country: 'SK',
          },
        },
        delivery: {
          method: 'zbox',
          pointId: '',
          addressConfirmed: true,
          instructions: 'Volajte po príchode.',
        },
        consent: { accepted: true, version: 'physical-v1' },
      },
    });
    renderCheckout();

    expect(await screen.findByRole('heading', { name: /doručenie/i })).toBeInTheDocument();
    expect(screen.getByText(/nezadávajte domácu adresu/i)).toBeInTheDocument();
    expect(screen.queryByText(/vybrať výdajné miesto na mape/i)).not.toBeInTheDocument();

    await fillBillingDetails();
    await fillManualPacketaAddress();
    await userEvent.click(screen.getByLabelText(/zadal\/a som adresu vybraného Packeta/i));
    await userEvent.click(screen.getByLabelText(/súhlasím s podmienkami fyzickej objednávky/i));
    await userEvent.click(screen.getByRole('button', { name: /pokračovať k bezpečnej platbe/i }));

    await waitFor(() => expect(saveCheckoutCustomer).toHaveBeenCalledOnce());
    expect(saveCheckoutCustomer).toHaveBeenCalledWith(expect.objectContaining({
      customer: expect.objectContaining({
        shipping: {
          name: 'Buyer Rabbit',
          phone: '+421900000000',
          address: {
            line1: 'Hlavná 10',
            line2: 'Z-BOX Bratislava',
            city: 'Bratislava',
            state: '',
            postal_code: '81101',
            country: 'SK',
          },
        },
        delivery: {
          method: 'zbox',
          pointId: '',
          addressConfirmed: true,
          instructions: 'Volajte po príchode.',
        },
        consent: { accepted: true, version: 'physical-v1' },
      }),
    }));
  });

  it('focuses the required Packeta-address confirmation before saving', async () => {
    vi.mocked(loadCheckoutAttempt).mockResolvedValue({ ...draftBootstrap, display: physicalDisplay });
    renderCheckout();

    await screen.findByRole('heading', { name: /doručenie/i });
    await fillBillingDetails();
    await fillManualPacketaAddress();
    await userEvent.click(screen.getByLabelText(/súhlasím s podmienkami fyzickej objednávky/i));
    await userEvent.click(screen.getByRole('button', { name: /pokračovať k bezpečnej platbe/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/vyplňte prosím všetky povinné údaje/i);
    expect(screen.getByLabelText(/zadal\/a som adresu vybraného Packeta/i)).toHaveFocus();
    expect(saveCheckoutCustomer).not.toHaveBeenCalled();
  });

  it('announces missing details, focuses the first invalid field, and never initializes payment', async () => {
    renderCheckout();
    await screen.findByRole('heading', { name: /dokončite objednávku/i });
    await userEvent.click(screen.getByRole('button', { name: /pokračovať k bezpečnej platbe/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/vyplňte prosím všetky povinné údaje/i);
    expect(screen.getByLabelText(/^e-mail$/i)).toHaveFocus();
    expect(saveCheckoutCustomer).not.toHaveBeenCalled();
    expect(stripeActions.confirm).not.toHaveBeenCalled();
  });

  it('supports a zero-total authoritative Session without mounting a payment field', async () => {
    vi.mocked(loadCheckoutAttempt).mockResolvedValue({
      ...readyBootstrap,
      display: { ...display, discountAmount: 499, total: 0, coupon: { code: 'FREE100', discountAmount: 499 } },
    });
    renderCheckout();
    expect(await screen.findByText(/platobná karta nie je potrebná/i)).toBeInTheDocument();
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /dokončiť objednávku/i }));
    await waitFor(() => expect(stripeActions.confirm).toHaveBeenCalledOnce());
  });

  it('keeps a verified membership email immutable before payment bootstrap', async () => {
    const membershipDraft = {
      ...draftBootstrap,
      attempt: { ...draftBootstrap.attempt, kind: 'membership' },
      display: {
        ...display,
        kind: 'membership',
        recurring: { interval: 'month', intervalCount: 1 },
        customer: { email: 'member@example.invalid' },
        coupon: null,
      },
    };
    vi.mocked(loadCheckoutAttempt).mockResolvedValue(membershipDraft);
    renderCheckout();
    expect(await screen.findByText('member@example.invalid')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /zľavový kód/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^e-mail$/i)).not.toBeInTheDocument();
    await fillBillingDetails({ email: false });
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /pokračovať/i }));
    await waitFor(() => expect(saveCheckoutCustomer).toHaveBeenCalledWith(expect.objectContaining({
      customer: expect.objectContaining({ email: 'member@example.invalid' }),
    })));
  });

  it('announces a decline and allows a safe retry', async () => {
    vi.mocked(loadCheckoutAttempt).mockResolvedValue(readyBootstrap);
    stripeActions.confirm.mockResolvedValue({ type: 'error', error: { code: 'paymentFailed', message: 'Karta bola zamietnutá.' } });
    renderCheckout();
    await userEvent.click(await screen.findByTestId('payment-element'));
    await userEvent.click(screen.getByRole('button', { name: /zaplatiť/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Karta bola zamietnutá.');
    expect(alert).toHaveFocus();
    expect(screen.getByRole('button', { name: /zaplatiť/i })).toBeEnabled();
  });

  it('records an authentication return and renders only authoritative processing state', async () => {
    vi.mocked(recordCheckoutReturn).mockResolvedValue({
      ...readyBootstrap,
      attempt: { ...readyBootstrap.attempt, resultState: 'processing' },
      stripe: { sessionId: 'cs_test_example' },
    });
    renderCheckout(`/checkout/return?attempt_id=${ATTEMPT_ID}`);
    const heading = await screen.findByRole('heading', { name: /platbu bezpečne potvrdzujeme/i });
    expect(heading).toHaveFocus();
    expect(recordCheckoutReturn).toHaveBeenCalledWith(ATTEMPT_ID, ATTEMPT_TOKEN);
    expect(screen.getByText(/čakáme na podpísaný Stripe webhook/i)).toBeInTheDocument();
  });

  it('surfaces Stripe initialization errors instead of leaving a silent disabled form', async () => {
    vi.mocked(loadCheckoutAttempt).mockResolvedValue(readyBootstrap);
    stripeHook.type = 'error';
    stripeHook.error = { message: 'Stripe sa nepodarilo načítať.' };
    renderCheckout();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Stripe sa nepodarilo načítať.');
    expect(alert).toHaveFocus();
    expect(screen.getByRole('button', { name: /zaplatiť/i })).toBeDisabled();
  });

  it('locks coupon controls after details are finalized and cannot race payment confirmation', async () => {
    vi.mocked(loadCheckoutAttempt).mockResolvedValue({
      ...readyBootstrap,
      display: noCouponDisplay,
    });
    renderCheckout();

    const couponInput = await screen.findByRole('textbox', { name: /^zľavový kód$/i });
    expect(couponInput).toBeDisabled();
    expect(screen.getByText(/zľavu možno zmeniť pred pokračovaním k platbe/i)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('payment-element'));
    await userEvent.click(screen.getByRole('button', { name: /zaplatiť 4,99/i }));
    await waitFor(() => expect(stripeActions.confirm).toHaveBeenCalledOnce());
    expect(mutateCheckoutAttemptCoupon).not.toHaveBeenCalled();
  });

  it('remounts Checkout Elements and handles paid-to-zero-to-paid Session transitions', async () => {
    const props = {
      attempt: { id: ATTEMPT_ID, token: ATTEMPT_TOKEN },
      couponBusy: false,
      onApplyCoupon: vi.fn(),
      onRemoveCoupon: vi.fn(),
      onStateChange: vi.fn(),
    };
    const view = render(
      <MemoryRouter>
        <CheckoutPaymentStage
          {...props}
          bootstrap={readyBootstrap}
          elementsOptions={{ clientSecret: readyBootstrap.stripe.clientSecret }}
        />
      </MemoryRouter>
    );
    const paidProvider = screen.getByTestId('checkout-provider');
    expect(screen.getByTestId('payment-element')).toBeInTheDocument();

    const rotatedSecretBootstrap = {
      ...readyBootstrap,
      stripe: {
        ...readyBootstrap.stripe,
        clientSecret: 'cs_test_ready_rotated_secret',
      },
    };
    view.rerender(
      <MemoryRouter>
        <CheckoutPaymentStage
          {...props}
          bootstrap={rotatedSecretBootstrap}
          elementsOptions={{ clientSecret: rotatedSecretBootstrap.stripe.clientSecret }}
        />
      </MemoryRouter>
    );
    const rotatedProvider = screen.getByTestId('checkout-provider');
    expect(rotatedProvider).not.toBe(paidProvider);

    const freeBootstrap = {
      ...readyBootstrap,
      display: {
        ...display,
        items: display.items.map((item) => ({ ...item, discountAmount: 499, netAmount: 0 })),
        discountAmount: 499,
        total: 0,
        coupon: { code: 'FREE100', name: 'Darček', kind: 'manual', discountAmount: 499 },
      },
      stripe: {
        ...readyBootstrap.stripe,
        sessionId: 'cs_test_free',
        clientSecret: 'cs_test_free_secret',
      },
    };
    view.rerender(
      <MemoryRouter>
        <CheckoutPaymentStage
          {...props}
          bootstrap={freeBootstrap}
          elementsOptions={{ clientSecret: freeBootstrap.stripe.clientSecret }}
        />
      </MemoryRouter>
    );
    const freeProvider = screen.getByTestId('checkout-provider');
    expect(freeProvider).not.toBe(rotatedProvider);
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dokončiť objednávku/i })).toBeEnabled();

    const paidAgain = {
      ...readyBootstrap,
      display: noCouponDisplay,
      stripe: {
        ...readyBootstrap.stripe,
        sessionId: 'cs_test_paid_again',
        clientSecret: 'cs_test_paid_again_secret',
      },
    };
    view.rerender(
      <MemoryRouter>
        <CheckoutPaymentStage
          {...props}
          bootstrap={paidAgain}
          elementsOptions={{ clientSecret: paidAgain.stripe.clientSecret }}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId('checkout-provider')).not.toBe(freeProvider);
    expect(screen.getByTestId('payment-element')).toBeInTheDocument();
  });

  it('uses the synchronous coupon lock before payment confirmation starts', async () => {
    render(
      <MemoryRouter>
        <CheckoutPaymentStage
          bootstrap={readyBootstrap}
          attempt={{ id: ATTEMPT_ID, token: ATTEMPT_TOKEN }}
          couponBusy={false}
          isCouponMutationLocked={() => true}
          elementsOptions={{ clientSecret: readyBootstrap.stripe.clientSecret }}
          onApplyCoupon={vi.fn()}
          onRemoveCoupon={vi.fn()}
          onStateChange={vi.fn()}
        />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByTestId('payment-element'));
    await userEvent.click(screen.getByRole('button', { name: /zaplatiť 3,99/i }));
    expect(stripeActions.validateElements).not.toHaveBeenCalled();
    expect(stripeActions.confirm).not.toHaveBeenCalled();
  });
});
