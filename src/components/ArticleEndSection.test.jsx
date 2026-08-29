import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPostSummaries, signupForWelcomeDiscount } from '../api/client';
import { CartProvider } from '../cart/CartContext';
import { clearArticleInterestProfile } from '../utils/articleRecommendations';
import {
  clearNewsletterSubscriberRecognition,
  isNewsletterSubscriberRecognized,
  markNewsletterSubscriberRecognized,
} from '../utils/newsletterSubscriber';
import { clearEmailCaptureSuppression } from '../utils/welcomeDiscount';
import ArticleEndSection from './ArticleEndSection';

vi.mock('../api/client', () => ({
  loadPostSummaries: vi.fn(),
  loadWelcomeDiscountOffer: vi.fn(),
  signupForWelcomeDiscount: vi.fn(),
}));

const article = {
  id: 1,
  slug: 'preco-kralik-dupe',
  title: 'Prečo králik dupe?',
  excerpt: 'Dupanie a komunikácia králika.',
  content: 'Králik dupe pri strachu alebo strese.',
  category: 'Správanie',
};

const summaries = [
  article,
  {
    id: 2,
    slug: 'rec-tela-kralika',
    title: 'Reč tela králika',
    excerpt: 'Ako králik komunikuje strach a pohodu.',
    category: 'Správanie',
    image: '/rabbit-body-language.jpg',
  },
  {
    id: 3,
    slug: 'stres-u-kralika',
    title: 'Ako spoznať stres u králika',
    excerpt: 'Najčastejšie prejavy stresu.',
    category: 'Správanie',
    image: '/rabbit-stress.jpg',
  },
  {
    id: 4,
    slug: 'seno-pre-kralika',
    title: 'Ako vybrať seno',
    excerpt: 'Základ zdravej stravy.',
    category: 'Strava',
    image: '/rabbit-hay.jpg',
  },
];

const renderSection = () => render(
  <MemoryRouter initialEntries={['/post/preco-kralik-dupe']}>
    <CartProvider>
      <ArticleEndSection article={article} viewKey="article-view" />
    </CartProvider>
  </MemoryRouter>
);

beforeEach(() => {
  window.localStorage.clear();
  clearEmailCaptureSuppression();
  clearNewsletterSubscriberRecognition();
  clearArticleInterestProfile();
  vi.clearAllMocks();
  vi.mocked(loadPostSummaries).mockResolvedValue(summaries);
});

describe('ArticleEndSection', () => {
  it('shows the compact newsletter CTA to a new anonymous visitor', () => {
    renderSection();

    expect(screen.getByRole('heading', { name: /nezmeškaj ďalšie články/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Tvoj e-mail')).toHaveAttribute('type', 'email');
    expect(screen.getByRole('checkbox')).toBeRequired();
    expect(loadPostSummaries).not.toHaveBeenCalled();
  });

  it('switches to recommendations only after confirmed signup succeeds', async () => {
    const user = userEvent.setup();
    vi.mocked(signupForWelcomeDiscount).mockResolvedValue({
      ok: true,
      guideDelivery: 'email',
      emailSent: true,
      alreadySubscribed: false,
    });
    renderSection();

    await user.type(screen.getByLabelText('Tvoj e-mail'), 'citatel@example.com');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /chcem články a príručku/i }));

    expect(await screen.findByRole('heading', { name: 'Čítaj ďalej' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /reč tela králika/i })).toHaveAttribute(
      'href',
      '/post/rec-tela-kralika',
    );
    expect(screen.queryByRole('heading', { name: /nezmeškaj ďalšie články/i }))
      .not.toBeInTheDocument();
    expect(isNewsletterSubscriberRecognized()).toBe(true);
    expect(signupForWelcomeDiscount).toHaveBeenCalledWith(expect.objectContaining({
      source: 'article',
      incentive: 'care-guide',
    }));
  });

  it('shows recommendations immediately to a returning recognized subscriber', async () => {
    markNewsletterSubscriberRecognized();
    renderSection();

    expect(screen.getByRole('heading', { name: 'Čítaj ďalej' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Tvoj e-mail')).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /ako spoznať stres/i })).toBeInTheDocument();
  });

  it('keeps the CTA visible and does not persist recognition after a failed request', async () => {
    const user = userEvent.setup();
    vi.mocked(signupForWelcomeDiscount).mockRejectedValue(new Error('network_failed'));
    renderSection();

    await user.type(screen.getByLabelText('Tvoj e-mail'), 'citatel@example.com');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /chcem články a príručku/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/prihlásenie sa nepodarilo/i);
    expect(screen.getByLabelText('Tvoj e-mail')).toBeInTheDocument();
    expect(isNewsletterSubscriberRecognized()).toBe(false);
    await waitFor(() => expect(loadPostSummaries).not.toHaveBeenCalled());
  });
});
