import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Eye,
  FilePlus2,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  MailCheck,
  Megaphone,
  Paperclip,
  PencilLine,
  Plus,
  Quote,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  createAdminMarketingCampaign,
  deleteAdminMarketingAttachment,
  loadAdminMarketingCampaign,
  loadAdminMarketingWorkspace,
  queueAdminMarketingCampaign,
  retryAdminMarketingCampaign,
  sendAdminMarketingTest,
  updateAdminMarketingCampaign,
  uploadAdminMarketingAttachment,
} from '../../api/client';
import '../../styles/admin-marketing.css';

const STATUS_LABELS = {
  draft: 'Koncept',
  queued: 'Vo fronte',
  sending: 'Odosiela sa',
  completed: 'Odoslané',
  completed_with_errors: 'Dokončené s chybami',
};

const DEFAULT_CAMPAIGN = {
  name: 'Nový newsletter',
  subject: '',
  preheader: '',
  bodyMarkdown: 'Ahoj,\n\nnapíš sem novinky pre komunitu Zajkológie.\n\nS láskou,\nTím Zajkológia',
  ctaLabel: '',
  ctaUrl: '',
};

const EMPTY_AUDIENCE = { total: 0, active: 0, excluded: 0, guide: 0, discount: 0 };

const formatDate = (value) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('sk-SK', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
};

const formatBytes = (bytes) => {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} kB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const marketingErrorMessage = (error) => {
  const messages = {
    invalid_email: 'Zadaj platnú e-mailovú adresu pre test.',
    marketing_campaign_invalid: 'Skontroluj označené polia.',
    marketing_campaign_locked: 'Odoslanú kampaň už nemožno upravovať.',
    marketing_campaign_already_queued: 'Táto kampaň už bola zaradená na odoslanie.',
    marketing_audience_empty: 'V databáze zatiaľ nie je žiadny aktívny odberateľ.',
    marketing_attachment_too_large: 'Jeden súbor môže mať najviac 10 MB.',
    marketing_attachments_total_too_large: 'Prílohy spolu môžu mať najviac 20 MB.',
    marketing_attachment_type_unsupported: 'Podporované sú PDF, obrázky, Word, Excel, PowerPoint, TXT a CSV.',
    marketing_attachment_invalid: 'Súbor sa nezhoduje so svojou príponou alebo je poškodený.',
    marketing_attachment_limit_reached: 'Ku kampani možno pridať najviac 5 príloh.',
  };
  return messages[error?.message] || 'Akciu sa nepodarilo dokončiť. Skús to, prosím, znova.';
};

const MarketingEmailSection = () => {
  const [audience, setAudience] = useState(EMPTY_AUDIENCE);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [announcementKind, setAnnouncementKind] = useState('info');
  const [fieldErrors, setFieldErrors] = useState({});
  const [viewMode, setViewMode] = useState('compose');
  const [testEmail, setTestEmail] = useState('');
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendConfirmation, setSendConfirmation] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const editorRef = useRef(null);
  const uploadRef = useRef(null);
  const sendDialogInputRef = useRef(null);
  const sendDialogOpenerRef = useRef(null);
  const sendDialogRef = useRef(null);
  const campaignRequestRef = useRef(0);
  const busyActionRef = useRef('');
  busyActionRef.current = busyAction;

  const beginAction = (name) => {
    if (busyActionRef.current) return false;
    busyActionRef.current = name;
    setBusyAction(name);
    return true;
  };

  const endAction = () => {
    busyActionRef.current = '';
    setBusyAction('');
  };

  const replaceCampaign = (campaign, { select = true } = {}) => {
    if (!campaign) return;
    setCampaigns((current) => {
      const exists = current.some((item) => item.id === campaign.id);
      return exists
        ? current.map((item) => item.id === campaign.id ? { ...item, ...campaign } : item)
        : [campaign, ...current];
    });
    if (select) {
      setDraft(campaign);
      setSelectedId(campaign.id);
      setIsDirty(false);
    }
  };

  const loadCampaign = async (campaignId) => {
    if (!campaignId) {
      setDraft(null);
      return;
    }
    const requestId = ++campaignRequestRef.current;
    setDetailLoading(true);
    try {
      const campaign = await loadAdminMarketingCampaign(campaignId);
      if (requestId !== campaignRequestRef.current) return;
      if (campaign) replaceCampaign(campaign);
    } catch (error) {
      setAnnouncement(marketingErrorMessage(error));
      setAnnouncementKind('error');
    } finally {
      if (requestId === campaignRequestRef.current) setDetailLoading(false);
    }
  };

  const loadWorkspace = async ({ keepSelection = true } = {}) => {
    setLoading(true);
    try {
      const data = await loadAdminMarketingWorkspace();
      setAudience(data.audience || EMPTY_AUDIENCE);
      setCampaigns(data.campaigns || []);
      const targetId = keepSelection && selectedId && data.campaigns.some((item) => item.id === selectedId)
        ? selectedId
        : data.campaigns[0]?.id || null;
      setSelectedId(targetId);
      if (targetId) await loadCampaign(targetId);
      else setDraft(null);
    } catch (error) {
      setAnnouncement(marketingErrorMessage(error));
      setAnnouncementKind('error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace({ keepSelection: false });
    // The admin section is mounted for one route and owns its initial fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const hasActiveDelivery = campaigns.some((campaign) => ['queued', 'sending'].includes(campaign.status));
  useEffect(() => {
    if (!hasActiveDelivery) return undefined;
    const interval = window.setInterval(async () => {
      try {
        const data = await loadAdminMarketingWorkspace();
        setAudience(data.audience || EMPTY_AUDIENCE);
        setCampaigns(data.campaigns || []);
        const selected = data.campaigns.find((campaign) => campaign.id === selectedId);
        if (selected && selected.status !== 'draft') {
          const detail = await loadAdminMarketingCampaign(selected.id);
          if (detail) setDraft(detail);
        }
      } catch {
        // Keep the current screen usable; the manual refresh remains available.
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [hasActiveDelivery, selectedId]);

  useEffect(() => {
    if (!sendDialogOpen) return undefined;
    const opener = sendDialogOpenerRef.current;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && busyActionRef.current !== 'queue') {
        setSendDialogOpen(false);
        setSendConfirmation('');
        return;
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(sendDialogRef.current?.querySelectorAll(
          'button:not([disabled]), input:not([disabled])'
        ) || []);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(() => sendDialogInputRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.requestAnimationFrame(() => opener?.focus());
    };
  }, [sendDialogOpen]);

  const updateDraft = (patch) => {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setIsDirty(true);
    setFieldErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((key) => delete next[key]);
      return next;
    });
  };

  const selectCampaign = async (campaign) => {
    if (busyActionRef.current) return;
    if (campaign.id === selectedId) return;
    if (isDirty && !window.confirm('Máš neuložené zmeny. Zahodiť ich a otvoriť inú kampaň?')) return;
    campaignRequestRef.current += 1;
    setSelectedId(campaign.id);
    setAnnouncement('');
    setFieldErrors({});
    await loadCampaign(campaign.id);
  };

  const createCampaign = async () => {
    if (isDirty && !window.confirm('Máš neuložené zmeny. Zahodiť ich a vytvoriť nový e-mail?')) return;
    if (!beginAction('create')) return;
    setAnnouncement('');
    try {
      const campaign = await createAdminMarketingCampaign(DEFAULT_CAMPAIGN);
      replaceCampaign(campaign);
      setViewMode('compose');
      setAnnouncement('Nový koncept je pripravený.');
      setAnnouncementKind('success');
    } catch (error) {
      setAnnouncement(marketingErrorMessage(error));
      setAnnouncementKind('error');
    } finally {
      endAction();
    }
  };

  const persistDraft = async ({ announce = true } = {}) => {
    if (!draft?.id || draft.status !== 'draft') return draft;
    campaignRequestRef.current += 1;
    const campaign = await updateAdminMarketingCampaign(draft.id, {
      name: draft.name,
      subject: draft.subject,
      preheader: draft.preheader,
      bodyMarkdown: draft.bodyMarkdown,
      ctaLabel: draft.ctaLabel,
      ctaUrl: draft.ctaUrl,
    });
    replaceCampaign(campaign);
    setFieldErrors({});
    if (announce) {
      setAnnouncement('Koncept je uložený.');
      setAnnouncementKind('success');
    }
    return campaign;
  };

  const saveDraft = async (event) => {
    event.preventDefault();
    if (!beginAction('save')) return;
    setAnnouncement('');
    try {
      await persistDraft();
    } catch (error) {
      setFieldErrors(error?.data?.details || {});
      setAnnouncement(marketingErrorMessage(error));
      setAnnouncementKind('error');
    } finally {
      endAction();
    }
  };

  const applyMarkdown = (before, after = before, placeholder = 'text') => {
    const textarea = editorRef.current;
    if (!textarea || !draft) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = draft.bodyMarkdown.slice(start, end) || placeholder;
    const nextValue = `${draft.bodyMarkdown.slice(0, start)}${before}${selected}${after}${draft.bodyMarkdown.slice(end)}`;
    updateDraft({ bodyMarkdown: nextValue });
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const addList = (ordered = false) => {
    const textarea = editorRef.current;
    if (!textarea || !draft) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = draft.bodyMarkdown.slice(start, end) || 'Prvá položka\nDruhá položka';
    const lines = selected.split('\n').map((line, index) => `${ordered ? `${index + 1}.` : '-'} ${line}`).join('\n');
    const nextValue = `${draft.bodyMarkdown.slice(0, start)}${lines}${draft.bodyMarkdown.slice(end)}`;
    updateDraft({ bodyMarkdown: nextValue });
    window.requestAnimationFrame(() => textarea.focus());
  };

  const uploadAttachments = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length || !draft?.id) return;
    if (!beginAction('upload')) return;
    setAnnouncement('');
    let uploadedCount = 0;
    let savedBeforeUpload = false;
    const campaignId = draft.id;
    try {
      await persistDraft({ announce: false });
      savedBeforeUpload = true;
      for (const file of files) {
        await uploadAdminMarketingAttachment(campaignId, file);
        uploadedCount += 1;
      }
      setAnnouncement(files.length === 1 ? 'Príloha je pridaná.' : `${files.length} prílohy sú pridané.`);
      setAnnouncementKind('success');
    } catch (error) {
      setAnnouncement(uploadedCount
        ? `${uploadedCount} z ${files.length} príloh sa podarilo pridať. ${marketingErrorMessage(error)}`
        : marketingErrorMessage(error));
      setAnnouncementKind('error');
    } finally {
      if (savedBeforeUpload || uploadedCount) await loadCampaign(campaignId);
      endAction();
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const removeAttachment = async (attachment) => {
    if (!window.confirm(`Odstrániť prílohu „${attachment.filename}“?`)) return;
    if (!beginAction(`delete-${attachment.id}`)) return;
    try {
      await persistDraft({ announce: false });
      await deleteAdminMarketingAttachment(draft.id, attachment.id);
      await loadCampaign(draft.id);
      setAnnouncement('Príloha bola odstránená.');
      setAnnouncementKind('success');
    } catch (error) {
      setAnnouncement(marketingErrorMessage(error));
      setAnnouncementKind('error');
    } finally {
      endAction();
    }
  };

  const sendTest = async (event) => {
    event.preventDefault();
    if (!beginAction('test')) return;
    setAnnouncement('');
    try {
      const saved = await persistDraft({ announce: false });
      await sendAdminMarketingTest(saved.id, testEmail);
      setAnnouncement(`Test bol odoslaný na ${testEmail.trim()}.`);
      setAnnouncementKind('success');
    } catch (error) {
      setFieldErrors(error?.data?.details || {});
      setAnnouncement(marketingErrorMessage(error));
      setAnnouncementKind('error');
    } finally {
      endAction();
    }
  };

  const openSendDialog = async (event) => {
    if (!beginAction('prepare')) return;
    sendDialogOpenerRef.current = event.currentTarget;
    setAnnouncement('');
    try {
      await persistDraft({ announce: false });
      setSendConfirmation('');
      setSendDialogOpen(true);
    } catch (error) {
      setFieldErrors(error?.data?.details || {});
      setAnnouncement(marketingErrorMessage(error));
      setAnnouncementKind('error');
    } finally {
      endAction();
    }
  };

  const refreshWorkspace = () => {
    if (busyActionRef.current) return;
    if (isDirty && !window.confirm('Máš neuložené zmeny. Zahodiť ich a obnoviť údaje?')) return;
    campaignRequestRef.current += 1;
    loadWorkspace();
  };

  const queueCampaign = async () => {
    if (!beginAction('queue')) return;
    try {
      const campaign = await queueAdminMarketingCampaign(draft.id, sendConfirmation);
      replaceCampaign(campaign);
      setSendDialogOpen(false);
      setSendConfirmation('');
      setAnnouncement(`Kampaň je vo fronte pre ${campaign.audienceCount} aktívnych odberateľov.`);
      setAnnouncementKind('success');
      await loadWorkspace();
    } catch (error) {
      setAnnouncement(marketingErrorMessage(error));
      setAnnouncementKind('error');
      setSendDialogOpen(false);
    } finally {
      endAction();
    }
  };

  const retryCampaign = async () => {
    if (!beginAction('retry')) return;
    try {
      const campaign = await retryAdminMarketingCampaign(draft.id);
      replaceCampaign(campaign);
      setAnnouncement('Neúspešné doručenia sú znovu vo fronte.');
      setAnnouncementKind('success');
    } catch (error) {
      setAnnouncement(marketingErrorMessage(error));
      setAnnouncementKind('error');
    } finally {
      endAction();
    }
  };

  const progress = useMemo(() => {
    if (!draft?.audienceCount) return 0;
    return Math.min(100, Math.round(((draft.sentCount + draft.failedCount + draft.skippedCount) / draft.audienceCount) * 100));
  }, [draft]);
  const isDraft = draft?.status === 'draft';

  return (
    <div className="admin-marketing">
      <header className="admin-marketing__header">
        <div>
          <span className="admin-marketing__eyebrow">Komunikácia s komunitou</span>
          <h1>Marketingové e-maily</h1>
          <p>Vytvor pekný newsletter, pošli si test a bezpečne ho odošli všetkým aktívnym odberateľom.</p>
        </div>
        <div className="admin-marketing__header-actions">
          <span className="admin-marketing__sender"><MailCheck size={17} aria-hidden="true" />marketing@zajkologia.com</span>
          <button type="button" className="is-secondary" onClick={refreshWorkspace} disabled={loading || Boolean(busyAction)}>
            <RefreshCw size={17} aria-hidden="true" />Obnoviť
          </button>
          <button type="button" className="is-primary" onClick={createCampaign} disabled={Boolean(busyAction)}>
            <Plus size={17} aria-hidden="true" />Nový e-mail
          </button>
        </div>
      </header>

      <div className="admin-marketing__audience" aria-label="Marketingové publikum">
        <div className="is-primary"><UsersRound size={20} aria-hidden="true" /><span>Aktívni odberatelia</span><strong>{audience.active}</strong></div>
        <div><FilePlus2 size={20} aria-hidden="true" /><span>PDF príručka</span><strong>{audience.guide}</strong></div>
        <div><Megaphone size={20} aria-hidden="true" /><span>Zľavová registrácia</span><strong>{audience.discount}</strong></div>
        <div><ShieldCheck size={20} aria-hidden="true" /><span>Vylúčení / odhlásení</span><strong>{audience.excluded}</strong></div>
      </div>

      <div className={`admin-marketing__announcement is-${announcementKind}`} role={announcementKind === 'error' ? 'alert' : 'status'} aria-live="polite">
        {announcement}
      </div>

      <div className="admin-marketing__workspace">
        <aside className="admin-marketing__catalog" aria-label="Kampane">
          <div className="admin-marketing__catalog-heading"><span>Kampane</span><small>{campaigns.length}</small></div>
          {loading && <div className="admin-marketing__empty" role="status">Načítavam kampane…</div>}
          {!loading && !campaigns.length && (
            <div className="admin-marketing__empty">
              <Send size={25} aria-hidden="true" />
              <strong>Zatiaľ bez kampaní</strong>
              <span>Začni tlačidlom „Nový e-mail“.</span>
            </div>
          )}
          <div className="admin-marketing__campaign-list">
            {campaigns.map((campaign) => (
              <button
                type="button"
                key={campaign.id}
                className={`admin-marketing__campaign${campaign.id === selectedId ? ' is-selected' : ''}`}
                onClick={() => selectCampaign(campaign)}
                disabled={Boolean(busyAction)}
                aria-pressed={campaign.id === selectedId}
              >
                <span className={`admin-marketing__badge is-${campaign.status}`}>{STATUS_LABELS[campaign.status] || campaign.status}</span>
                <strong>{campaign.name || 'Bez názvu'}</strong>
                <span>{campaign.subject || 'Bez predmetu'}</span>
                <small>{formatDate(campaign.updatedAt)}</small>
                {campaign.status !== 'draft' && <small>{campaign.sentCount}/{campaign.audienceCount} odoslaných</small>}
              </button>
            ))}
          </div>
        </aside>

        <section className="admin-marketing__editor" aria-busy={detailLoading}>
          {!draft ? (
            <div className="admin-marketing__editor-empty">
              <Megaphone size={36} aria-hidden="true" />
              <h2>Priprav prvý newsletter</h2>
              <p>Vytvor koncept, uprav obsah, pridaj prílohy a najprv si pošli test.</p>
              <button type="button" className="is-primary" onClick={createCampaign} disabled={Boolean(busyAction)}><Plus size={17} />Nový e-mail</button>
            </div>
          ) : (
            <>
              <div className="admin-marketing__editor-topbar">
                <div>
                  <span>{isDraft ? 'Koncept' : STATUS_LABELS[draft.status]}</span>
                  <h2>{draft.name || 'Newsletter'}</h2>
                </div>
                <div className="admin-marketing__mode-switch" aria-label="Zobrazenie obsahu">
                  <button type="button" className={viewMode === 'compose' ? 'is-active' : ''} onClick={() => setViewMode('compose')} aria-pressed={viewMode === 'compose'}><PencilLine size={16} />Upraviť</button>
                  <button type="button" className={viewMode === 'preview' ? 'is-active' : ''} onClick={() => setViewMode('preview')} aria-pressed={viewMode === 'preview'}><Eye size={16} />Náhľad</button>
                </div>
              </div>

              {!isDraft && (
                <section className="admin-marketing__delivery-status" aria-label="Stav odosielania">
                  <div><span>Priebeh odosielania</span><strong>{progress}%</strong></div>
                  <div className="admin-marketing__progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
                  <dl>
                    <div><dt>Publikum</dt><dd>{draft.audienceCount}</dd></div>
                    <div><dt>Odoslané</dt><dd>{draft.sentCount}</dd></div>
                    <div><dt>Vynechané</dt><dd>{draft.skippedCount}</dd></div>
                    <div><dt>Chyby</dt><dd>{draft.failedCount}</dd></div>
                  </dl>
                  {draft.status === 'completed_with_errors' && <button type="button" className="is-secondary" onClick={retryCampaign} disabled={busyAction === 'retry'}><RotateCcw size={16} />Skúsiť chyby znova</button>}
                </section>
              )}

              {viewMode === 'compose' ? (
                <form className="admin-marketing__form" onSubmit={saveDraft} noValidate>
                  <fieldset disabled={!isDraft || Boolean(busyAction && busyAction !== 'upload')}>
                    <legend>Základné údaje</legend>
                    <div className="admin-marketing__form-grid">
                      <label>
                        <span>Interný názov *</span>
                        <input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} maxLength={160} aria-invalid={Boolean(fieldErrors.name)} />
                        {fieldErrors.name && <small className="is-error">{fieldErrors.name}</small>}
                      </label>
                      <label>
                        <span>Predmet e-mailu *</span>
                        <input value={draft.subject} onChange={(event) => updateDraft({ subject: event.target.value })} maxLength={200} placeholder="Čo nové čaká tvojeho králika?" aria-invalid={Boolean(fieldErrors.subject)} />
                        <small className={fieldErrors.subject ? 'is-error' : ''}>{fieldErrors.subject || `${draft.subject.length}/200 znakov`}</small>
                      </label>
                    </div>
                    <label>
                      <span>Krátky náhľad v schránke</span>
                      <input value={draft.preheader} onChange={(event) => updateDraft({ preheader: event.target.value })} maxLength={255} placeholder="Jedna veta, ktorú človek uvidí vedľa predmetu." />
                    </label>
                  </fieldset>

                  <fieldset disabled={!isDraft || Boolean(busyAction && busyAction !== 'upload')}>
                    <legend>Obsah</legend>
                    <div className="admin-marketing__toolbar" role="toolbar" aria-label="Formátovanie textu">
                      <button type="button" onClick={() => applyMarkdown('**', '**', 'tučný text')} aria-label="Tučné"><Bold size={17} /></button>
                      <button type="button" onClick={() => applyMarkdown('*', '*', 'kurzíva')} aria-label="Kurzíva"><Italic size={17} /></button>
                      <button type="button" onClick={() => applyMarkdown('## ', '', 'Nadpis')} aria-label="Nadpis"><Heading2 size={17} /></button>
                      <button type="button" onClick={() => addList(false)} aria-label="Odrážkový zoznam"><List size={17} /></button>
                      <button type="button" onClick={() => addList(true)} aria-label="Číslovaný zoznam"><ListOrdered size={17} /></button>
                      <button type="button" onClick={() => applyMarkdown('[', '](https://zajkologia.com)', 'text odkazu')} aria-label="Odkaz"><Link size={17} /></button>
                      <button type="button" onClick={() => applyMarkdown('> ', '', 'Dôležitá poznámka')} aria-label="Citácia"><Quote size={17} /></button>
                    </div>
                    <label className="admin-marketing__body-label">
                      <span>Text e-mailu *</span>
                      <textarea ref={editorRef} value={draft.bodyMarkdown} onChange={(event) => updateDraft({ bodyMarkdown: event.target.value })} rows={18} aria-invalid={Boolean(fieldErrors.bodyMarkdown)} />
                      <small className={fieldErrors.bodyMarkdown ? 'is-error' : ''}>{fieldErrors.bodyMarkdown || 'Označ text a použi tlačidlá formátovania. Výsledok skontroluj v náhľade.'}</small>
                    </label>
                    <div className="admin-marketing__form-grid">
                      <label><span>Text tlačidla</span><input value={draft.ctaLabel} onChange={(event) => updateDraft({ ctaLabel: event.target.value })} maxLength={120} placeholder="Prečítať nový článok" aria-invalid={Boolean(fieldErrors.ctaLabel)} />{fieldErrors.ctaLabel && <small className="is-error">{fieldErrors.ctaLabel}</small>}</label>
                      <label><span>Odkaz tlačidla</span><input type="url" value={draft.ctaUrl} onChange={(event) => updateDraft({ ctaUrl: event.target.value })} placeholder="https://zajkologia.com/..." aria-invalid={Boolean(fieldErrors.ctaUrl)} />{fieldErrors.ctaUrl && <small className="is-error">{fieldErrors.ctaUrl}</small>}</label>
                    </div>
                  </fieldset>

                  <fieldset disabled={!isDraft || Boolean(busyAction)}>
                    <legend>Prílohy</legend>
                    <div className="admin-marketing__attachments-heading">
                      <p>Najviac 5 súborov, 10 MB na súbor a 20 MB spolu. PDF, obrázky, Word, Excel, PowerPoint, TXT alebo CSV.</p>
                      <label className="admin-marketing__upload">
                        <Paperclip size={17} aria-hidden="true" />{busyAction === 'upload' ? 'Nahrávam…' : 'Pridať prílohy'}
                        <input ref={uploadRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx,.txt,.csv" onChange={uploadAttachments} />
                      </label>
                    </div>
                    <ul className="admin-marketing__attachments">
                      {(draft.attachments || []).map((attachment) => (
                        <li key={attachment.id}>
                          <span><Paperclip size={16} aria-hidden="true" /><span><strong>{attachment.filename}</strong><small>{formatBytes(attachment.fileSize)}</small></span></span>
                          <button type="button" onClick={() => removeAttachment(attachment)} disabled={busyAction === `delete-${attachment.id}`} aria-label={`Odstrániť prílohu ${attachment.filename}`}><Trash2 size={16} /></button>
                        </li>
                      ))}
                      {!draft.attachments?.length && <li className="is-empty">Bez príloh — e-mail môžeš odoslať aj bez nich.</li>}
                    </ul>
                  </fieldset>

                  {isDraft && (
                    <div className="admin-marketing__save-row">
                      <button className="is-primary" type="submit" disabled={Boolean(busyAction)}><Save size={17} />{busyAction === 'save' ? 'Ukladám…' : 'Uložiť koncept'}</button>
                    </div>
                  )}
                </form>
              ) : (
                <section className="admin-marketing__preview-wrap" aria-label="Náhľad e-mailu">
                  <div className="admin-marketing__inbox-preview"><span>Predmet</span><strong>{draft.subject || 'Bez predmetu'}</strong><small>{draft.preheader || 'Bez krátkeho náhľadu'}</small></div>
                  <article className="admin-marketing__email-preview">
                    <header><strong>Zajkológia</strong><span>S láskou ku králikom</span></header>
                    <div className="admin-marketing__email-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.bodyMarkdown}</ReactMarkdown>
                      {draft.ctaLabel && draft.ctaUrl && <a className="admin-marketing__preview-cta" href={draft.ctaUrl} onClick={(event) => event.preventDefault()}>{draft.ctaLabel}</a>}
                      <p>S láskou,<br /><strong>Tím Zajkológia</strong></p>
                      <small>Tento e-mail dostávaš, pretože si súhlasil/a s odberom noviniek Zajkológie. <u>Odhlásiť sa z odberu</u>.</small>
                    </div>
                  </article>
                </section>
              )}

              {isDraft && (
                <section className="admin-marketing__send-panel" aria-labelledby="marketing-send-title">
                  <div><span>Posledná kontrola</span><h3 id="marketing-send-title">Odporúčame najprv poslať test</h3><p>Test ide iba na zadanú adresu. Ostré odoslanie vytvorí nemenný zoznam aktívnych odberateľov a odhlásených automaticky vynechá.</p></div>
                  <form onSubmit={sendTest}>
                    <label htmlFor="marketing-test-email">Testovací e-mail</label>
                    <div><input id="marketing-test-email" type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="tvoj@email.sk" required /><button type="submit" className="is-secondary" disabled={Boolean(busyAction)}><MailCheck size={17} />{busyAction === 'test' ? 'Posielam…' : 'Poslať test'}</button></div>
                  </form>
                  <button type="button" className="admin-marketing__send-live" onClick={openSendDialog} disabled={Boolean(busyAction) || audience.active === 0}><Send size={18} />Odoslať {audience.active} odberateľom</button>
                </section>
              )}
            </>
          )}
        </section>
      </div>

      {sendDialogOpen && (
        <div className="admin-marketing__dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && busyAction !== 'queue') setSendDialogOpen(false); }}>
          <section ref={sendDialogRef} className="admin-marketing__dialog" role="dialog" aria-modal="true" aria-labelledby="marketing-dialog-title">
            <button type="button" className="admin-marketing__dialog-close" onClick={() => setSendDialogOpen(false)} disabled={busyAction === 'queue'} aria-label="Zavrieť"><X size={19} /></button>
            <div className="admin-marketing__dialog-icon"><Send size={22} aria-hidden="true" /></div>
            <h2 id="marketing-dialog-title">Odoslať ostrú kampaň?</h2>
            <p><strong>{draft.subject}</strong> sa zaradí do fronty pre aktuálne aktívnych odberateľov. Každý dostane vlastný odhlasovací odkaz.</p>
            <dl><div><dt>Aktívne publikum</dt><dd>{audience.active}</dd></div><div><dt>Prílohy</dt><dd>{draft.attachmentCount || 0}</dd></div><div><dt>Odosielateľ</dt><dd>marketing@zajkologia.com</dd></div></dl>
            <label htmlFor="marketing-send-confirmation">Pre potvrdenie napíš <strong>ODOSLAŤ</strong></label>
            <input ref={sendDialogInputRef} id="marketing-send-confirmation" value={sendConfirmation} onChange={(event) => setSendConfirmation(event.target.value.toUpperCase())} autoComplete="off" />
            <div className="admin-marketing__dialog-actions"><button type="button" className="is-secondary" onClick={() => setSendDialogOpen(false)} disabled={busyAction === 'queue'}>Zrušiť</button><button type="button" className="is-danger" onClick={queueCampaign} disabled={sendConfirmation !== 'ODOSLAŤ' || busyAction === 'queue'}><Send size={17} />{busyAction === 'queue' ? 'Zaraďujem…' : 'Áno, odoslať všetkým'}</button></div>
          </section>
        </div>
      )}
    </div>
  );
};

export default MarketingEmailSection;
