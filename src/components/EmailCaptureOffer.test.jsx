import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWelcomeDiscountOffer, signupForWelcomeDiscount } from '../api/client';
import { CartProvider } from '../cart/CartContext';
import { CART_STORAGE_KEY } from '../cart/cartState';
import { clearEmailCaptureSuppression } from '../utils/welcomeDiscount';
import EmailCaptureOffer from './EmailCaptureOffer';

vi.mock('../api/client', () => ({
  loadWelcomeDiscountOffer: vi.fn(),
  signupForWelcomeDiscount: vi.fn(),
}));

beforeEach(() => {
  window.localStorage.clear();
  clearEmailCaptureSuppression();
  vi.clearAllMocks();
});

describe('EmailCaptureOffer', () => {
  const renderOffer = (placement = 'home') => render(
    <CartProvider>
      <EmailCaptureOffer placement={placement} />
    </CartProvider>
  );

  it('renders the canonical welcome amount instead of a hard-coded percentage', async () => {
    vi.mocked(loadWelcomeDiscountOffer).mockResolvedValue({
      name: 'Augustová uvítacia zľava',
      discountType: 'percent_off',
      percentOff: 30,
      amountOff: null,
      currency: 'eur',
    });

    renderOffer('product');

    expect((await screen.findAllByText(/30% zľav/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/25%/)).not.toBeInTheDocument();
  });

  it('does not solicit a claim when the canonical welcome coupon is unavailable', async () => {
    vi.mocked(loadWelcomeDiscountOffer).mockResolvedValue(null);
    renderOffer('product');

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /uvítacia zľava/i })).not.toBeInTheDocument();
    });
  });

  it('applies a directly issued welcome claim to the shared persisted checkout state', async () => {
    const user = userEvent.setup();
    vi.mocked(loadWelcomeDiscountOffer).mockResolvedValue({
      name: 'Uvítacia zľava',
      discountType: 'percent_off',
      percentOff: 25,
      currency: 'eur',
    });
    vi.mocked(signupForWelcomeDiscount).mockResolvedValue({
      discountAvailable: true,
      discountCode: 'welcome25',
      discountToken: 'private-claim-token',
      emailSent: true,
    });

    renderOffer('product');
    await user.type(await screen.findByLabelText('E-mailová adresa'), 'zakaznik@example.com');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /chcem zľavový kód/i }));

    expect(await screen.findByText('WELCOME25')).toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY));
      expect(stored.coupon).toMatchObject({
        code: 'WELCOME25',
        claimToken: 'private-claim-token',
        source: 'welcome',
      });
    });
  });

  it('renders the homepage guide offer with semantic email fields even without a discount campaign', async () => {
    vi.mocked(loadWelcomeDiscountOffer).mockResolvedValue(null);

    renderOffer('home');

    expect(await screen.findByRole('heading', {
      name: /Buď medzi prvými, ktorí sa dozvedia o nových článkoch a tipoch/i,
    })).toBeInTheDocument();
    expect(screen.getByText(/Ako bonus za prihlásenie získaš zadarmo PDF príručku/i))
      .toBeInTheDocument();
    const guideMockup = screen.getByRole('img', {
      name: /náhľad PDF príručky Základy starostlivosti o králika/i,
    });
    expect(guideMockup).toHaveAttribute('src', '/newsletter/care-guide-mockup.png');
    expect(guideMockup).toHaveAttribute('width', '6000');
    expect(guideMockup).toHaveAttribute('height', '3375');

    const email = screen.getByLabelText('Zadaj svoj e-mail');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(email).toBeRequired();
    expect(screen.getByRole('button', { name: /chcem dostávať novinky/i })).toBeEnabled();
  });

  it('shows readable consent details and returns focus to the opener when closed', async () => {
    const user = userEvent.setup();
    vi.mocked(loadWelcomeDiscountOffer).mockResolvedValue(null);
    renderOffer('home');

    const detailsButton = await screen.findByRole('button', {
      name: /viac informácií/i,
    });
    await user.click(detailsButton);

    const dialog = screen.getByRole('dialog', { name: /marketingový súhlas/i });
    expect(dialog).toHaveAttribute('open');
    expect(within(dialog).getByText(/Z odberu sa môžeš kedykoľvek odhlásiť/i)).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Rozumiem' }));

    expect(dialog).not.toHaveAttribute('open');
    expect(detailsButton).toHaveFocus();
  });

  it('submits the homepage guide through the existing newsletter integration and shows success', async () => {
    const user = userEvent.setup();
    vi.mocked(loadWelcomeDiscountOffer).mockResolvedValue(null);
    vi.mocked(signupForWelcomeDiscount).mockResolvedValue({
      guideDelivery: 'email',
      emailSent: true,
      discountAvailable: false,
      alreadySubscribed: false,
    });

    renderOffer('home');
    await user.type(await screen.findByLabelText('Zadaj svoj e-mail'), 'citatel@example.com');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /chcem dostávať novinky/i }));

    expect(signupForWelcomeDiscount).toHaveBeenCalledWith({
      email: 'citatel@example.com',
      consentAccepted: true,
      source: 'home',
      incentive: 'care-guide',
    });
    expect(await screen.findByText('Ďakujeme!')).toBeInTheDocument();
    expect(screen.getByText(/Príručku sme ti poslali v prílohe/i)).toBeInTheDocument();
  });

  it('shows loading and error states for the homepage guide form', async () => {
    const user = userEvent.setup();
    vi.mocked(loadWelcomeDiscountOffer).mockResolvedValue(null);
    let rejectSignup;
    vi.mocked(signupForWelcomeDiscount).mockImplementation(() => new Promise((_, reject) => {
      rejectSignup = reject;
    }));

    renderOffer('home');
    await user.type(await screen.findByLabelText('Zadaj svoj e-mail'), 'citatel@example.com');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /chcem dostávať novinky/i }));

    expect(screen.getByRole('button', { name: 'Odosielam…' })).toBeDisabled();
    rejectSignup(new Error('network_failed'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Prihlásenie sa nepodarilo/i);
  });

  it('explains when guide delivery is rate limited', async () => {
    const user = userEvent.setup();
    vi.mocked(loadWelcomeDiscountOffer).mockResolvedValue(null);
    vi.mocked(signupForWelcomeDiscount).mockRejectedValue({
      data: { error: 'newsletter_rate_limited' },
      status: 429,
    });

    renderOffer('home');
    await user.type(await screen.findByLabelText('Zadaj svoj e-mail'), 'citatel@example.com');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /chcem dostávať novinky/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/limit odosielania/i);
  });
});
