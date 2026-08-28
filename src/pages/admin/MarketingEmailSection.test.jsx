import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAdminMarketingCampaign,
  loadAdminMarketingCampaign,
  loadAdminMarketingWorkspace,
  queueAdminMarketingCampaign,
  sendAdminMarketingTest,
  updateAdminMarketingCampaign,
} from '../../api/client';
import MarketingEmailSection from './MarketingEmailSection';

vi.mock('../../api/client', () => ({
  createAdminMarketingCampaign: vi.fn(),
  deleteAdminMarketingAttachment: vi.fn(),
  loadAdminMarketingCampaign: vi.fn(),
  loadAdminMarketingWorkspace: vi.fn(),
  queueAdminMarketingCampaign: vi.fn(),
  retryAdminMarketingCampaign: vi.fn(),
  sendAdminMarketingTest: vi.fn(),
  updateAdminMarketingCampaign: vi.fn(),
  uploadAdminMarketingAttachment: vi.fn(),
}));

const draftCampaign = {
  id: 7,
  name: 'Augustové novinky',
  subject: 'Novinky pre tvojho králika',
  preheader: 'Praktické tipy zo Zajkológie',
  bodyMarkdown: 'Ahoj,\n\npozri si **nový článok** o starostlivosti.',
  ctaLabel: 'Prečítať článok',
  ctaUrl: 'https://zajkologia.com/post/novy-clanok',
  status: 'draft',
  audienceCount: 0,
  sentCount: 0,
  failedCount: 0,
  skippedCount: 0,
  attachmentCount: 0,
  attachmentBytes: 0,
  attachments: [],
  updatedAt: '2026-08-28T10:00:00.000Z',
};

const secondDraftCampaign = {
  ...draftCampaign,
  id: 8,
  name: 'Septembrové novinky',
  subject: 'Jesenné tipy pre králika',
  updatedAt: '2026-08-29T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadAdminMarketingWorkspace).mockResolvedValue({
    audience: { total: 15, active: 12, excluded: 3, guide: 7, discount: 5 },
    campaigns: [draftCampaign],
  });
  vi.mocked(loadAdminMarketingCampaign).mockResolvedValue(draftCampaign);
  vi.mocked(updateAdminMarketingCampaign).mockResolvedValue(draftCampaign);
  vi.mocked(sendAdminMarketingTest).mockResolvedValue({ ok: true });
  vi.mocked(createAdminMarketingCampaign).mockResolvedValue(draftCampaign);
  vi.mocked(queueAdminMarketingCampaign).mockResolvedValue({
    ...draftCampaign,
    status: 'queued',
    audienceCount: 12,
  });
});

describe('MarketingEmailSection', () => {
  it('shows the single consent-backed audience and a readable formatted preview', async () => {
    render(<MarketingEmailSection />);

    expect(await screen.findByRole('heading', { name: 'Augustové novinky' })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('PDF príručka')).toBeInTheDocument();
    expect(screen.getByText('Zľavová registrácia')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /náhľad/i }));
    const preview = screen.getByRole('region', { name: /náhľad e-mailu/i });
    expect(within(preview).getByText('nový článok').tagName).toBe('STRONG');
    expect(within(preview).getByText('Prečítať článok')).toBeInTheDocument();
    expect(within(preview).getByText(/odhlásiť sa z odberu/i)).toBeInTheDocument();
  });

  it('requires the typed live-send confirmation before queueing the active audience', async () => {
    render(<MarketingEmailSection />);
    const liveButton = await screen.findByRole('button', { name: /odoslať 12 odberateľom/i });
    await userEvent.click(liveButton);

    const dialog = await screen.findByRole('dialog', { name: /odoslať ostrú kampaň/i });
    const confirmButton = within(dialog).getByRole('button', { name: /áno, odoslať všetkým/i });
    expect(confirmButton).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/pre potvrdenie/i), 'ODOSLAŤ');
    expect(confirmButton).toBeEnabled();
    await userEvent.click(confirmButton);

    await waitFor(() => expect(queueAdminMarketingCampaign).toHaveBeenCalledWith(7, 'ODOSLAŤ'));
    expect(updateAdminMarketingCampaign).toHaveBeenCalledWith(7, expect.objectContaining({
      subject: 'Novinky pre tvojho králika',
    }));
  });

  it('keeps campaign selection locked while an async save is in flight', async () => {
    let resolveSave;
    vi.mocked(loadAdminMarketingWorkspace).mockResolvedValue({
      audience: { total: 15, active: 12, excluded: 3, guide: 7, discount: 5 },
      campaigns: [draftCampaign, secondDraftCampaign],
    });
    vi.mocked(updateAdminMarketingCampaign).mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve;
    }));
    render(<MarketingEmailSection />);

    await screen.findByRole('heading', { name: 'Augustové novinky' });
    await userEvent.click(screen.getByRole('button', { name: /uložiť koncept/i }));
    const secondCampaignButton = screen.getByRole('button', { name: /septembrové novinky/i });
    expect(secondCampaignButton).toBeDisabled();
    fireEvent.click(secondCampaignButton);
    expect(screen.getByRole('heading', { name: 'Augustové novinky' })).toBeInTheDocument();

    await act(async () => resolveSave(draftCampaign));
    await waitFor(() => expect(screen.getByRole('button', { name: /septembrové novinky/i })).toBeEnabled());
  });

  it('prevents duplicate campaign creation while the first request is pending', async () => {
    let resolveCreate;
    vi.mocked(loadAdminMarketingWorkspace).mockResolvedValue({
      audience: { total: 0, active: 0, excluded: 0, guide: 0, discount: 0 },
      campaigns: [],
    });
    vi.mocked(createAdminMarketingCampaign).mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    render(<MarketingEmailSection />);

    const newEmailButtons = await screen.findAllByRole('button', { name: /nový e-mail/i });
    const emptyStateButton = newEmailButtons.at(-1);
    fireEvent.click(emptyStateButton);
    fireEvent.click(emptyStateButton);
    expect(createAdminMarketingCampaign).toHaveBeenCalledOnce();
    expect(emptyStateButton).toBeDisabled();

    await act(async () => resolveCreate(draftCampaign));
  });

  it('closes the send dialog with Escape and restores focus to its opener', async () => {
    const user = userEvent.setup();
    render(<MarketingEmailSection />);
    const liveButton = await screen.findByRole('button', { name: /odoslať 12 odberateľom/i });
    await user.click(liveButton);
    await screen.findByRole('dialog', { name: /odoslať ostrú kampaň/i });

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(liveButton).toHaveFocus());
  });
});
