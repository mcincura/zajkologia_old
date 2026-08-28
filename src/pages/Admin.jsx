import React, { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Ban, Download, FileText, Megaphone, Package, PackageCheck, RefreshCw, Send, ShieldCheck, Tag, UsersRound } from 'lucide-react';
import MarkdownContent from '../components/MarkdownContent';
import { apiFetch, apiUrl, mapPostFromApi } from '../api/client';
import ProductCmsSection from './admin/ProductCmsSection';
import AdminCouponsSection from './admin/AdminCouponsSection';
import MembershipAdminSection from './admin/MembershipAdminSection';
import MarketingEmailSection from './admin/MarketingEmailSection';
import { isShippableOrder } from '../utils/orderTypes';
import { extractMarkdownHeadings, selectTableOfContentsHeadings } from '../utils/markdownHeadings';
import {
    getDefaultRefundCategory,
    getFullRefundDigitalWarning,
    getOrderHasPhysicalItems,
    REFUND_CATEGORY_OPTIONS,
} from '../utils/adminRefunds';

const slugify = (value) => {
    return (value || '')
        .toString()
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
};

const formatToday = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const formatMoneyMinor = (amountMinor, currency = 'eur') => {
    const amount = Number(amountMinor || 0) / 100;
    const normalizedCurrency = (currency || 'eur').toUpperCase();

    try {
        return new Intl.NumberFormat('sk-SK', {
            style: 'currency',
            currency: normalizedCurrency,
        }).format(amount);
    } catch {
        return `${amount.toFixed(2)} ${normalizedCurrency}`;
    }
};

const formatSourceLabel = (row) => {
    const parts = [row.source, row.medium, row.campaign].filter(Boolean);
    return parts.length ? parts.join(' / ') : 'unknown';
};

const formatDateTime = (value) => {
    if (!value) return '—';
    try {
        return new Intl.DateTimeFormat('sk-SK', {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(new Date(value));
    } catch {
        return String(value);
    }
};

const parseEuroToMinor = (value) => {
    const normalized = String(value || '').trim().replace(',', '.');
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return Math.round(amount * 100);
};

const getPacketaDetailsText = (order) => {
    const lines = [
        `Meno: ${order.shippingName || order.customerName || ''}`,
        `Telefón: ${order.shippingPhone || ''}`,
        `Email: ${order.shippingEmail || order.customerEmail || ''}`,
        `Ulica a popisné číslo: ${order.shippingAddressLine1 || ''}`,
        order.shippingAddressLine2 ? `Doplnenie adresy: ${order.shippingAddressLine2}` : '',
        `Obec: ${order.shippingCity || ''}`,
        `PSČ: ${order.shippingPostalCode || ''}`,
        `Krajina: ${order.shippingCountry || ''}`,
    ].filter(Boolean);

    return lines.join('\n');
};

const adminNavLinkStyle = ({ isActive }) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '0.55rem',
    padding: '0.65rem 0.75rem',
    borderRadius: '8px',
    border: `1px solid ${isActive ? '#d9bfa5' : '#eee'}`,
    background: isActive ? '#fff7ed' : '#fff',
    color: isActive ? '#341320' : '#55463d',
    textDecoration: 'none',
    fontWeight: 900,
});

const createEmptyPost = (defaultCategoryId) => ({
    id: null,
    slug: '',
    title: '',
    excerpt: '',
    categoryId: defaultCategoryId ?? null,
    category: '',
    author: 'Tím Zajkológia',
    date: formatToday(),
    image: '/zajo.png',
    content: 'Úvodný text článku.\n\n## Prvý nadpis sekcie\n\nText sekcie.\n\n## Druhý nadpis sekcie\n\nĎalší text.\n',
    hasFaq: false,
    faqItems: [],
});

const DEFAULT_ORDER_FILTER = 'active';

const ORDER_FILTER_OPTIONS = [
    { value: 'active', label: 'Paid / active' },
    { value: 'paid_physical', label: 'Paid physical' },
    { value: 'paid', label: 'All paid' },
    { value: 'pending', label: 'Pending checkout' },
    { value: 'expired', label: 'Expired checkout' },
    { value: 'all', label: 'All non-archived' },
    { value: 'archived', label: 'Archived tests' },
];

const Admin = ({ section = 'orders' }) => {
    const [authLoading, setAuthLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [username, setUsername] = useState('');

    const [loginUsername, setLoginUsername] = useState('admin');
    const [loginPassword, setLoginPassword] = useState('');

    const [categories, setCategories] = useState([]);
    const [posts, setPosts] = useState([]);
    const [selectedId, setSelectedId] = useState(null);

    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [rebuildBusy, setRebuildBusy] = useState(false);

    const [analytics, setAnalytics] = useState(null);
    const [analyticsDays, setAnalyticsDays] = useState(30);
    const [analyticsLoading, setAnalyticsLoading] = useState(false);
    const [analyticsError, setAnalyticsError] = useState('');
    const [orders, setOrders] = useState([]);
    const [orderFilter, setOrderFilter] = useState(DEFAULT_ORDER_FILTER);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [ordersError, setOrdersError] = useState('');

    const selectedPost = useMemo(() => posts.find(p => p.id === selectedId) || null, [posts, selectedId]);
    const selectedPostTocHeadings = useMemo(
        () => selectTableOfContentsHeadings(extractMarkdownHeadings(selectedPost?.content)),
        [selectedPost?.content]
    );
    const isOrdersSection = section === 'orders';
    const isCouponsSection = section === 'coupons';
    const isProductsSection = section === 'products';
    const isPostsSection = section === 'posts';
    const isMembershipSection = section === 'membership';
    const isMarketingSection = section === 'marketing';
    const isWideAdminSection = isMembershipSection || isCouponsSection || isMarketingSection;
    const orderStats = useMemo(() => {
        const paidOrders = orders.filter((order) => ['paid', 'fulfilled'].includes(order.status));
        const physicalToShip = orders.filter((order) =>
            isShippableOrder(order) &&
            ['paid', 'fulfilled'].includes(order.status) &&
            !order.shippedAt
        );
        const refundRequestsToReview = orders.reduce(
            (total, order) =>
                total + (order.refundRequests || []).filter((request) => request.status === 'submitted').length,
            0
        );
        const revenueMinor = paidOrders.reduce(
            (total, order) => total + Number(order.amountTotal || 0) - Number(order.refundedAmount || 0),
            0
        );

        return {
            paidOrders: paidOrders.length,
            revenueMinor,
            currency: paidOrders[0]?.currency || analytics?.totals?.revenueCurrency || 'eur',
            physicalToShip: physicalToShip.length,
            refundRequestsToReview,
        };
    }, [analytics?.totals?.revenueCurrency, orders]);

    const loadAll = async () => {
        const [cats, ps] = await Promise.all([
            apiFetch('/api/categories'),
            apiFetch('/api/posts'),
        ]);

        setCategories(cats.categories || []);
        const mapped = (ps.posts || []).map(mapPostFromApi);
        setPosts(mapped);
        setSelectedId(mapped?.[0]?.id ?? null);
    };

    const loadAnalytics = async (daysOverride) => {
        const days = Number(daysOverride ?? analyticsDays) || 30;
        setAnalyticsLoading(true);
        setAnalyticsError('');
        try {
            const data = await apiFetch(`/api/analytics/summary?days=${days}`);
            setAnalytics(data);
        } catch (err) {
            setAnalytics(null);
            setAnalyticsError(`Analytics failed: ${err.message}`);
        } finally {
            setAnalyticsLoading(false);
        }
    };

    const loadOrders = async (filterOverride) => {
        const nextFilter = filterOverride || orderFilter;
        const params = new URLSearchParams({
            filter: nextFilter,
            limit: '100',
        });

        setOrdersLoading(true);
        setOrdersError('');
        try {
            const data = await apiFetch(`/api/orders/admin?${params.toString()}`);
            setOrders(data?.orders || []);
        } catch (err) {
            setOrders([]);
            setOrdersError(`Orders failed: ${err.message}`);
        } finally {
            setOrdersLoading(false);
        }
    };

    const resetAdminState = () => {
        setCategories([]);
        setPosts([]);
        setSelectedId(null);
        setOrders([]);
    };

    const checkAuth = async ({ fallbackUsername } = {}) => {
        setAuthLoading(true);
        try {
            const me = await apiFetch('/api/auth/me');
            const authed = Boolean(me?.isAuthenticated);
            setIsAuthenticated(authed);
            setUsername(me?.username || fallbackUsername || '');
            if (authed) {
                await loadAll();
                await loadAnalytics();
                await loadOrders();
            } else {
                resetAdminState();
            }
            return authed;
        } catch (err) {
            // Some backends skip /api/auth/me (it's optional in BACKEND_SPEC.md).
            // Fallback: try loading protected data; if it works, we are authenticated.
            if (err?.status === 404) {
                try {
                    await loadAll();
                    await loadAnalytics();
                    await loadOrders();
                    setIsAuthenticated(true);
                    setUsername(fallbackUsername || '');
                    return true;
                } catch {
                    setIsAuthenticated(false);
                    setUsername('');
                    resetAdminState();
                    return false;
                }
            } else {
                setIsAuthenticated(false);
                setUsername('');
                resetAdminState();
                return false;
            }
        } finally {
            setAuthLoading(false);
        }
    };

    useEffect(() => {
        checkAuth();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!isAuthenticated) return;
        loadAnalytics();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    const updateSelected = (patch) => {
        if (!selectedPost) return;
        setPosts(prev => prev.map(p => (p.id === selectedPost.id ? { ...p, ...patch } : p)));
    };

    const onLogin = async (e) => {
        e.preventDefault();
        setBusy(true);
        setStatus('');
        try {
            await apiFetch('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username: loginUsername, password: loginPassword }),
            });
            setLoginPassword('');

            const authed = await checkAuth({ fallbackUsername: loginUsername });
            if (!authed) {
                setStatus(
                    'Login returned ok, but the session is not active in the browser. ' +
                    'This usually means the session cookie was not stored/sent (CORS credentials, cookie SameSite/Secure, or different origin).'
                );
            } else {
                setStatus('');
            }
        } catch (err) {
            setStatus(`Login failed: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    const onLogout = async () => {
        setBusy(true);
        try {
            await apiFetch('/api/auth/logout', { method: 'POST' });
        } finally {
            setBusy(false);
            setIsAuthenticated(false);
            setUsername('');
            resetAdminState();
            setStatus('Logged out.');
        }
    };

    const createNewPost = () => {
        const post = createEmptyPost(categories?.[0]?.id ?? null);
        post.categoryId = categories?.[0]?.id ?? null;
        post.category = categories?.[0]?.name ?? '';
        // temporary negative id for UI selection
        post.id = -Date.now();
        setPosts(prev => [post, ...prev]);
        setSelectedId(post.id);
        setStatus('New post (not saved yet).');
    };

    const deleteSelected = async () => {
        if (!selectedPost) return;
        const ok = window.confirm(`Delete "${selectedPost.title || selectedPost.slug || selectedPost.id}"?`);
        if (!ok) return;

        // Not saved yet
        if (selectedPost.id < 0) {
            const remaining = posts.filter(p => p.id !== selectedPost.id);
            setPosts(remaining);
            setSelectedId(remaining?.[0]?.id ?? null);
            setStatus('Draft removed.');
            return;
        }

        setBusy(true);
        try {
            await apiFetch(`/api/posts/${selectedPost.id}`, { method: 'DELETE' });
            const remaining = posts.filter(p => p.id !== selectedPost.id);
            setPosts(remaining);
            setSelectedId(remaining?.[0]?.id ?? null);
            setStatus('Deleted.');
        } catch (err) {
            setStatus(`Delete failed: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    const saveSelected = async () => {
        if (!selectedPost) return;
        if (!selectedPost.title?.trim() || !selectedPost.slug?.trim() || !selectedPost.content?.trim()) {
            setStatus('Missing required fields: title, slug, content.');
            return;
        }

        const payload = {
            slug: selectedPost.slug,
            title: selectedPost.title,
            excerpt: selectedPost.excerpt || null,
            contentMd: selectedPost.content,
            imageUrl: selectedPost.image || null,
            author: selectedPost.author || null,
            categoryId: selectedPost.categoryId || null,
            publishedAt: selectedPost.date || null,
            hasFaq: selectedPost.hasFaq || false,
            faqContent: selectedPost.hasFaq && selectedPost.faqItems?.length > 0
                ? JSON.stringify(selectedPost.faqItems)
                : null,
        };

        setBusy(true);
        try {
            if (selectedPost.id < 0) {
                const created = await apiFetch('/api/posts', { method: 'POST', body: JSON.stringify(payload) });
                const mapped = mapPostFromApi(created.post);
                setPosts(prev => [mapped, ...prev.filter(p => p.id !== selectedPost.id)]);
                setSelectedId(mapped.id);
                setStatus('Created.');
            } else {
                const updated = await apiFetch(`/api/posts/${selectedPost.id}`, { method: 'PUT', body: JSON.stringify(payload) });
                const mapped = mapPostFromApi(updated.post);
                setPosts(prev => prev.map(p => (p.id === mapped.id ? mapped : p)));
                setStatus('Saved.');
            }
        } catch (err) {
            setStatus(`Save failed: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    const rebuildPublicSite = async () => {
        setRebuildBusy(true);
        setStatus('');
        try {
            const data = await apiFetch('/api/frontend-rebuild', {
                method: 'POST',
                body: JSON.stringify({
                    reason: 'manual_admin_rebuild',
                    slug: selectedPost?.slug || '',
                }),
            });

            if (data?.rebuild?.dispatched) {
                setStatus('Public site rebuild requested.');
            } else if (data?.rebuild?.skipped) {
                setStatus('Public site rebuild skipped because rebuild automation is disabled.');
            } else {
                setStatus('Public site rebuild request queued.');
            }
        } catch (err) {
            setStatus(`Public site rebuild failed: ${err.message}`);
        } finally {
            setRebuildBusy(false);
        }
    };

    const reviewRefundRequest = async (request, decision) => {
        const adminReason = window.prompt(
            decision === 'approved'
                ? 'Reason for approving this refund request:'
                : 'Reason for rejecting this refund request:'
        );
        if (!adminReason?.trim()) return;

        setBusy(true);
        setStatus('');
        try {
            const data = await apiFetch(`/api/orders/admin/refund-requests/${request.id}/review`, {
                method: 'POST',
                body: JSON.stringify({ decision, adminReason }),
            });
            await loadOrders();
            setStatus(
                data?.emailError
                    ? `Refund request ${decision}, but email failed: ${data.emailError}`
                    : data?.emailSent
                        ? `Refund request ${decision} and customer email sent.`
                        : `Refund request ${decision}.`
            );
        } catch (err) {
            setStatus(`Refund review failed: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    const createAdminRefund = async (order, request = null) => {
        const refundableMinor = Number(order.amountTotal || 0) - Number(order.refundedAmount || 0);
        if (refundableMinor <= 0) {
            setStatus('This order has no refundable amount left.');
            return;
        }

        const amountInput = window.prompt(
            `Refund amount in EUR. Max ${formatMoneyMinor(refundableMinor, order.currency)}:`,
            (refundableMinor / 100).toFixed(2)
        );
        if (amountInput == null) {
            setStatus('Refund cancelled before amount was confirmed. No Stripe refund was created.');
            return;
        }

        const amount = parseEuroToMinor(amountInput);
        if (!amount) {
            setStatus('Invalid refund amount. No Stripe refund was created.');
            return;
        }
        if (amount > refundableMinor) {
            setStatus(`Refund amount is higher than the remaining refundable amount (${formatMoneyMinor(refundableMinor, order.currency)}). No Stripe refund was created.`);
            return;
        }

        const category = window.prompt(
            `Refund category: ${REFUND_CATEGORY_OPTIONS.join(', ')}`,
            getDefaultRefundCategory(request)
        );
        if (category == null) {
            setStatus('Refund cancelled before category was confirmed. No Stripe refund was created.');
            return;
        }

        const normalizedCategory = category.trim();
        if (!REFUND_CATEGORY_OPTIONS.includes(normalizedCategory)) {
            setStatus(`Invalid refund category "${normalizedCategory}". Use one of: ${REFUND_CATEGORY_OPTIONS.join(', ')}. No Stripe refund was created.`);
            return;
        }

        const adminReason = window.prompt('Internal admin reason/decision note:');
        if (adminReason == null) {
            setStatus('Refund cancelled before admin reason was confirmed. No Stripe refund was created.');
            return;
        }
        if (!adminReason.trim()) {
            setStatus('Admin reason is required. No Stripe refund was created.');
            return;
        }

        const fullRefundDigitalWarning = getFullRefundDigitalWarning({
            order,
            amount,
            refundableMinor,
            formattedRefundAmount: formatMoneyMinor(refundableMinor, order.currency),
        });
        if (fullRefundDigitalWarning && !window.confirm(fullRefundDigitalWarning)) {
            setStatus('Full digital/mixed refund cancelled at extra confirmation. No Stripe refund was created.');
            return;
        }

        const restock = getOrderHasPhysicalItems(order) && !order.shippedAt
            ? window.confirm('Restock/release the reserved product variant after refund succeeds?')
            : false;
        const confirmed = window.confirm(
            `Create Stripe refund for ${formatMoneyMinor(amount, order.currency)} on order ${order.id}?`
        );
        if (!confirmed) {
            setStatus('Refund cancelled at final confirmation. No Stripe refund was created.');
            return;
        }

        setBusy(true);
        setStatus(`Creating Stripe refund for ${formatMoneyMinor(amount, order.currency)}…`);
        try {
            const data = await apiFetch(`/api/orders/admin/${order.id}/refund`, {
                method: 'POST',
                body: JSON.stringify({
                    amount,
                    category: normalizedCategory,
                    adminReason: adminReason.trim(),
                    refundRequestId: request?.id || null,
                    manualOverride: !request,
                    restock,
                    confirm: true,
                }),
            });
            await loadOrders();
            await loadAnalytics();
            setStatus(
                data?.emailError
                    ? `Stripe refund created, but refund email failed: ${data.emailError}`
                    : data?.emailSent
                        ? 'Stripe refund created and refund email sent.'
                        : 'Stripe refund created and saved locally.'
            );
        } catch (err) {
            setStatus(`Refund failed: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    const copyPacketaDetails = async (order) => {
        const text = getPacketaDetailsText(order);
        if (!text.trim()) {
            setStatus('No shipping details to copy.');
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            setStatus('Packeta details copied.');
        } catch {
            window.prompt('Copy Packeta details:', text);
        }
    };

    const downloadShippingCsv = async (includeShipped = false) => {
        setBusy(true);
        setStatus('');
        try {
            const path = `/api/orders/admin/export/shipping.csv${includeShipped ? '?includeShipped=true' : ''}`;
            const res = await fetch(apiUrl(path), { credentials: 'include' });
            if (!res.ok) throw new Error(`http_${res.status}`);

            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = includeShipped
                ? 'zajkologia-shipping-all.csv'
                : 'zajkologia-shipping-unshipped.csv';
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(objectUrl);
            setStatus('Shipping CSV download started.');
        } catch (err) {
            setStatus(`Shipping CSV export failed: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    const markOrderShipped = async (order) => {
        const carrier = window.prompt('Carrier:', order.carrier || 'Packeta');
        if (!carrier?.trim()) return;

        const trackingNumber = window.prompt('Tracking number:', order.trackingNumber || '');
        if (!trackingNumber?.trim()) return;

        const trackingUrl = window.prompt('Tracking URL (optional):', order.trackingUrl || '');
        const sendEmail = window.confirm('Send tracking email to the customer now?');
        const confirmed = window.confirm(
            `${order.shippedAt ? 'Update tracking' : 'Mark order as shipped'} for ${order.id}?`
        );
        if (!confirmed) return;

        setBusy(true);
        setStatus('');
        try {
            const data = await apiFetch(`/api/orders/admin/${order.id}/shipment`, {
                method: 'POST',
                body: JSON.stringify({
                    carrier,
                    trackingNumber,
                    trackingUrl,
                    sendEmail,
                }),
            });
            await loadOrders();
            setStatus(
                data?.emailError
                    ? `Shipment saved, but tracking email failed: ${data.emailError}`
                    : data?.emailSent
                        ? 'Shipment saved and tracking email sent.'
                        : 'Shipment saved.'
            );
        } catch (err) {
            setStatus(`Shipment update failed: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    const replaceLoadedOrder = (updatedOrder) => {
        if (!updatedOrder?.id) return;
        setOrders((prev) => prev.map((order) => (order.id === updatedOrder.id ? updatedOrder : order)));
    };

    const resendDigitalDeliveryEmail = async (order) => {
        const confirmed = window.confirm(`Resend secure PDF download email for order ${order.id}?`);
        if (!confirmed) return;

        setBusy(true);
        setStatus('');
        try {
            const data = await apiFetch(`/api/orders/admin/${order.id}/digital-delivery/resend`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            replaceLoadedOrder(data.order);
            setStatus('Secure PDF download email sent.');
        } catch (err) {
            setStatus(`Digital delivery resend failed: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    const regenerateDigitalDeliveryEmail = async (order) => {
        const confirmed = window.confirm(`Regenerate secure PDF links and email them for order ${order.id}? Previous email links will stop working.`);
        if (!confirmed) return;

        setBusy(true);
        setStatus('');
        try {
            const data = await apiFetch(`/api/orders/admin/${order.id}/digital-delivery/regenerate`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            replaceLoadedOrder(data.order);
            setStatus('Secure PDF links regenerated and emailed.');
        } catch (err) {
            setStatus(`Digital delivery regenerate failed: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    const revokeDigitalDeliveryLinks = async (order) => {
        const reason = window.prompt('Reason for revoking these download links:', 'Admin revoked access');
        if (reason == null) return;
        const confirmed = window.confirm(`Revoke active secure PDF links for order ${order.id}?`);
        if (!confirmed) return;

        setBusy(true);
        setStatus('');
        try {
            const data = await apiFetch(`/api/orders/admin/${order.id}/digital-delivery/revoke`, {
                method: 'POST',
                body: JSON.stringify({ reason: reason.trim() }),
            });
            replaceLoadedOrder(data.order);
            setStatus('Secure PDF links revoked.');
        } catch (err) {
            setStatus(`Digital delivery revoke failed: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    if (authLoading) {
        return <div className="container" style={{ padding: '2rem 0' }}>Loading…</div>;
    }

    if (!isAuthenticated) {
        return (
            <div className="container" style={{ maxWidth: 520, padding: '3rem 0' }}>
                <h1>Admin login</h1>
                <p style={{ color: '#666', marginBottom: '1rem' }}>This login is validated by the backend. No secrets are stored in the frontend.</p>

                <form onSubmit={onLogin} style={{ background: 'white', padding: '1rem', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.75rem' }}>
                        <span style={{ fontSize: '0.85rem', color: '#666' }}>Username</span>
                        <input value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} style={{ padding: '0.6rem 0.75rem', border: '1px solid #eee', borderRadius: '8px' }} />
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.75rem' }}>
                        <span style={{ fontSize: '0.85rem', color: '#666' }}>Password</span>
                        <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} style={{ padding: '0.6rem 0.75rem', border: '1px solid #eee', borderRadius: '8px' }} />
                    </label>

                    <button disabled={busy} style={{ background: 'var(--color-primary)', color: 'white', padding: '0.6rem 0.9rem', borderRadius: '8px', fontWeight: 800 }}>
                        {busy ? 'Logging in…' : 'Login'}
                    </button>

                    {status ? <div style={{ marginTop: '0.75rem', fontSize: '0.9rem', color: '#444' }}>{status}</div> : null}
                </form>
            </div>
        );
    }

    return (
        <div
            className={`container admin-page-layout ${isWideAdminSection ? 'is-membership' : ''}`}
            style={{
                display: 'grid',
                gridTemplateColumns: isWideAdminSection ? '260px minmax(0, 1fr)' : '320px minmax(0, 1fr)',
                gap: '1.5rem',
                maxWidth: isWideAdminSection ? '1800px' : undefined,
            }}
        >
            <aside style={{
                background: 'white',
                borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow)',
                padding: '1rem',
                height: 'fit-content',
                position: 'sticky',
                top: '1rem'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <h2 style={{ marginBottom: 0 }}>Admin</h2>
                    <button onClick={onLogout} disabled={busy} style={{ background: 'var(--color-light)', color: 'var(--color-dark)', padding: '0.4rem 0.65rem', borderRadius: '8px', fontWeight: 800 }}>
                        Logout
                    </button>
                </div>
                <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>Logged in as <b>{username}</b></div>

                <nav style={{ display: 'grid', gap: '0.5rem', marginBottom: '1rem' }} aria-label="Admin navigation">
                    <NavLink to="/admin/orders" style={adminNavLinkStyle}>
                        <PackageCheck size={18} strokeWidth={2.4} />
                        Orders
                    </NavLink>
                    <NavLink to="/admin/coupons" style={adminNavLinkStyle}>
                        <Tag size={18} strokeWidth={2.4} />
                        Coupons
                    </NavLink>
                    <NavLink to="/admin/marketing" style={adminNavLinkStyle}>
                        <Megaphone size={18} strokeWidth={2.4} />
                        Marketing e-mails
                    </NavLink>
                    <NavLink to="/admin/products" style={adminNavLinkStyle}>
                        <Package size={18} strokeWidth={2.4} />
                        Products
                    </NavLink>
                    <NavLink to="/admin/posts" style={adminNavLinkStyle}>
                        <FileText size={18} strokeWidth={2.4} />
                        Blog posts
                    </NavLink>
                    <NavLink to="/admin/membership" style={adminNavLinkStyle}>
                        <UsersRound size={18} strokeWidth={2.4} />
                        Membership
                    </NavLink>
                </nav>

                {isPostsSection ? (
                    <>
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                            <button
                                onClick={createNewPost}
                                disabled={busy}
                                style={{ background: 'var(--color-primary)', color: 'white', padding: '0.5rem 0.75rem', borderRadius: '6px', fontWeight: 700 }}
                            >
                                New
                            </button>
                            <button
                                onClick={saveSelected}
                                disabled={busy || !selectedPost}
                                style={{ background: 'var(--color-dark)', color: 'white', padding: '0.5rem 0.75rem', borderRadius: '6px', fontWeight: 700 }}
                            >
                                Save
                            </button>
                        </div>

                        <button
                            type="button"
                            onClick={rebuildPublicSite}
                            disabled={rebuildBusy}
                            style={{
                                width: '100%',
                                background: '#fff7ed',
                                color: '#7a3f00',
                                padding: '0.55rem 0.75rem',
                                borderRadius: '6px',
                                fontWeight: 800,
                                marginBottom: '1rem',
                                border: '1px solid #f1d7bd',
                            }}
                        >
                            {rebuildBusy ? 'Requesting rebuild…' : 'Rebuild public site'}
                        </button>
                    </>
                ) : null}

                {status ? (
                    <div style={{ fontSize: '0.9rem', color: '#444', background: '#fafafa', padding: '0.5rem 0.75rem', borderRadius: '6px', marginBottom: '1rem' }}>
                        {status}
                    </div>
                ) : null}

                {isOrdersSection ? (
                    <div style={{
                        border: '1px solid #eee',
                        borderRadius: '10px',
                        padding: '0.75rem',
                        marginBottom: '1rem',
                        background: '#fafafa'
                    }}>
                        <div style={{ fontWeight: 800, marginBottom: '0.55rem' }}>Today’s queue</div>
                        <div style={{ display: 'grid', gap: '0.45rem', fontSize: '0.86rem', color: '#55463d' }}>
                            <div><b>{orderStats.physicalToShip}</b> physical/mixed order(s) waiting to ship</div>
                            <div><b>{orderStats.refundRequestsToReview}</b> refund request(s) need review</div>
                            <div><b>{formatMoneyMinor(orderStats.revenueMinor, orderStats.currency)}</b> net loaded order revenue</div>
                        </div>
                    </div>
                ) : isPostsSection ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {posts.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => setSelectedId(p.id)}
                                style={{
                                    textAlign: 'left',
                                    padding: '0.6rem 0.75rem',
                                    borderRadius: '8px',
                                    background: p.id === selectedId ? 'var(--color-light)' : 'transparent',
                                    color: 'var(--color-dark)',
                                    border: '1px solid #eee'
                                }}
                            >
                                <div style={{ fontWeight: 800 }}>{p.title || '(Untitled)'}</div>
                                <div style={{ fontSize: '0.85rem', color: '#666' }}>{p.slug || 'missing-slug'} • {p.category || '—'}</div>
                            </button>
                        ))}
                    </div>
                ) : isMembershipSection ? (
                    <div style={{
                        border: '1px solid #eee',
                        borderRadius: '10px',
                        padding: '0.75rem',
                        background: '#fafafa',
                        color: '#55463d',
                        fontSize: '0.88rem',
                    }}>
                        Stripe-synchronized members and protected club content.
                    </div>
                ) : isCouponsSection ? (
                    <div style={{
                        border: '1px solid #eee',
                        borderRadius: '10px',
                        padding: '0.75rem',
                        background: '#fafafa',
                        color: '#55463d',
                        fontSize: '0.88rem',
                    }}>
                        Canonical coupon rules, claims, Stripe projection, and redemption history.
                    </div>
                ) : isMarketingSection ? (
                    <div style={{
                        border: '1px solid #eee',
                        borderRadius: '10px',
                        padding: '0.75rem',
                        background: '#fafafa',
                        color: '#55463d',
                        fontSize: '0.88rem',
                    }}>
                        One consent-backed audience for guide and discount signups, with unsubscribe protection.
                    </div>
                ) : (
                    <div style={{
                        border: '1px solid #eee',
                        borderRadius: '10px',
                        padding: '0.75rem',
                        background: '#fafafa',
                        color: '#55463d',
                        fontSize: '0.88rem',
                    }}>
                        Product catalog, variants, pricing, and publish status.
                    </div>
                )}
            </aside>

            <section style={{
                background: 'white',
                borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow)',
                padding: '1rem'
            }}>
                {isOrdersSection ? (
                    <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div style={{ border: '1px solid #ead9c7', borderRadius: '10px', padding: '1rem', background: '#fffaf5' }}>
                        <div style={{ fontSize: '0.78rem', color: '#7a5a43', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Revenue</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 950, color: '#341320', marginTop: '0.2rem' }}>
                            {formatMoneyMinor(analytics?.totals?.revenueMinor, analytics?.totals?.revenueCurrency)}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#7a5a43', marginTop: '0.2rem' }}>Last {analyticsDays} days</div>
                    </div>
                    <div style={{ border: '1px solid #ead9c7', borderRadius: '10px', padding: '1rem', background: '#fff' }}>
                        <div style={{ fontSize: '0.78rem', color: '#7a5a43', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Paid orders</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 950, color: '#341320', marginTop: '0.2rem' }}>
                            {analytics?.totals?.paidOrders ?? '—'}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#7a5a43', marginTop: '0.2rem' }}>Stripe-paid orders</div>
                    </div>
                    <div style={{ border: '1px solid #dbe9df', borderRadius: '10px', padding: '1rem', background: '#f7fcf8' }}>
                        <div style={{ fontSize: '0.78rem', color: '#276749', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>To ship</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 950, color: '#166534', marginTop: '0.2rem' }}>
                            {orderStats.physicalToShip}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#276749', marginTop: '0.2rem' }}>Physical/mixed orders without tracking</div>
                    </div>
                    <div style={{ border: '1px solid #f3d4b7', borderRadius: '10px', padding: '1rem', background: '#fff7ed' }}>
                        <div style={{ fontSize: '0.78rem', color: '#9a3412', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Refund review</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 950, color: '#9a3412', marginTop: '0.2rem' }}>
                            {orderStats.refundRequestsToReview}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#9a3412', marginTop: '0.2rem' }}>Manual decisions pending</div>
                    </div>
                </div>
                <div style={{
                    border: '1px solid #eee',
                    borderRadius: '10px',
                    padding: '1rem',
                    marginBottom: '1rem',
                    background: '#fafafa'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <h3 style={{ margin: 0 }}>Analytics</h3>
                            <span style={{ fontSize: '0.85rem', color: '#666' }}>Last {analyticsDays} days</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <select
                                value={analyticsDays}
                                onChange={(e) => {
                                    const days = Number(e.target.value);
                                    setAnalyticsDays(days);
                                    loadAnalytics(days);
                                }}
                                style={{ padding: '0.35rem 0.5rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.85rem' }}
                            >
                                <option value={7}>7 days</option>
                                <option value={30}>30 days</option>
                                <option value={90}>90 days</option>
                                <option value={180}>180 days</option>
                            </select>
                            <button
                                type="button"
                                onClick={() => loadAnalytics()}
                                disabled={analyticsLoading}
                                style={{ background: 'var(--color-dark)', color: 'white', padding: '0.35rem 0.6rem', borderRadius: '6px', fontWeight: 700, fontSize: '0.85rem' }}
                            >
                                {analyticsLoading ? 'Refreshing…' : 'Refresh'}
                            </button>
                        </div>
                    </div>

                    {analyticsError ? (
                        <div style={{ fontSize: '0.9rem', color: '#a40000' }}>{analyticsError}</div>
                    ) : null}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginTop: '0.5rem' }}>
                        <div style={{ background: 'white', border: '1px solid #eee', borderRadius: '8px', padding: '0.75rem' }}>
                            <div style={{ fontSize: '0.8rem', color: '#666' }}>Pageviews</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{analytics?.totals?.pageviews ?? '—'}</div>
                        </div>
                        <div style={{ background: 'white', border: '1px solid #eee', borderRadius: '8px', padding: '0.75rem' }}>
                            <div style={{ fontSize: '0.8rem', color: '#666' }}>Unique visitors</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{analytics?.totals?.uniqueVisitors ?? '—'}</div>
                        </div>
                        <div style={{ background: 'white', border: '1px solid #eee', borderRadius: '8px', padding: '0.75rem' }}>
                            <div style={{ fontSize: '0.8rem', color: '#666' }}>Days tracked</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{analytics?.rangeDays ?? analyticsDays}</div>
                        </div>
                        <div style={{ background: 'white', border: '1px solid #eee', borderRadius: '8px', padding: '0.75rem' }}>
                            <div style={{ fontSize: '0.8rem', color: '#666' }}>Paid orders</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{analytics?.totals?.paidOrders ?? '—'}</div>
                        </div>
                        <div style={{ background: 'white', border: '1px solid #eee', borderRadius: '8px', padding: '0.75rem' }}>
                            <div style={{ fontSize: '0.8rem', color: '#666' }}>Revenue</div>
                            <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{formatMoneyMinor(analytics?.totals?.revenueMinor, analytics?.totals?.revenueCurrency)}</div>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.35rem' }}>Pageviews by day</div>
                            <div style={{ border: '1px solid #eee', borderRadius: '8px', background: 'white', padding: '0.5rem', maxHeight: '220px', overflow: 'auto' }}>
                                {(analytics?.perDay || []).length === 0 ? (
                                    <div style={{ fontSize: '0.85rem', color: '#888' }}>No data.</div>
                                ) : (
                                    (analytics?.perDay || []).map((row) => (
                                        <div key={row.date} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: '0.5rem', padding: '0.35rem 0', borderBottom: '1px dashed #f0f0f0' }}>
                                            <div style={{ fontSize: '0.85rem', color: '#555' }}>{row.date}</div>
                                            <div style={{ fontSize: '0.85rem' }}>{row.pageviews} views</div>
                                            <div style={{ fontSize: '0.85rem', color: '#666' }}>{row.uniqueVisitors} uniques</div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.35rem' }}>Top posts</div>
                            <div style={{ border: '1px solid #eee', borderRadius: '8px', background: 'white', padding: '0.5rem' }}>
                                {(analytics?.topPosts || []).length === 0 ? (
                                    <div style={{ fontSize: '0.85rem', color: '#888' }}>No data.</div>
                                ) : (
                                    (analytics?.topPosts || []).map((row) => (
                                        <div key={row.postId} style={{ padding: '0.35rem 0', borderBottom: '1px dashed #f0f0f0' }}>
                                            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{row.title || row.slug}</div>
                                            <div style={{ fontSize: '0.8rem', color: '#666' }}>{row.pageviews} views • {row.uniqueVisitors} uniques</div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.35rem' }}>Sales by source</div>
                            <div style={{ border: '1px solid #eee', borderRadius: '8px', background: 'white', padding: '0.5rem', maxHeight: '220px', overflow: 'auto' }}>
                                {(analytics?.salesBySource || []).length === 0 ? (
                                    <div style={{ fontSize: '0.85rem', color: '#888' }}>No paid orders yet.</div>
                                ) : (
                                    (analytics?.salesBySource || []).map((row) => (
                                        <div key={`${row.source}-${row.medium}-${row.campaign}-${row.currency}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem', padding: '0.35rem 0', borderBottom: '1px dashed #f0f0f0' }}>
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{formatSourceLabel(row)}</div>
                                                <div style={{ fontSize: '0.8rem', color: '#666' }}>{row.paidOrders} paid orders</div>
                                            </div>
                                            <div style={{ fontSize: '0.85rem', fontWeight: 800 }}>{formatMoneyMinor(row.revenueMinor, row.currency)}</div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.35rem' }}>Sales from blog posts</div>
                            <div style={{ border: '1px solid #eee', borderRadius: '8px', background: 'white', padding: '0.5rem', maxHeight: '220px', overflow: 'auto' }}>
                                {(analytics?.salesByPost || []).length === 0 ? (
                                    <div style={{ fontSize: '0.85rem', color: '#888' }}>No blog-attributed sales yet.</div>
                                ) : (
                                    (analytics?.salesByPost || []).map((row) => (
                                        <div key={`${row.slug}-${row.currency}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem', padding: '0.35rem 0', borderBottom: '1px dashed #f0f0f0' }}>
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{row.title || row.slug}</div>
                                                <div style={{ fontSize: '0.8rem', color: '#666' }}>{row.paidOrders} paid orders</div>
                                            </div>
                                            <div style={{ fontSize: '0.85rem', fontWeight: 800 }}>{formatMoneyMinor(row.revenueMinor, row.currency)}</div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
                <div style={{
                    border: '1px solid #eee',
                    borderRadius: '10px',
                    padding: '1rem',
                    marginBottom: '1rem',
                    background: '#fafafa'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.75rem' }}>
                        <div>
                            <h3 style={{ margin: 0 }}>Orders</h3>
                            <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
                                Physical preorders, refund review, and admin-only Stripe refunds.
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                onClick={() => downloadShippingCsv(false)}
                                disabled={busy}
                                title="Download unshipped physical orders as CSV"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', padding: '0.35rem 0.6rem', borderRadius: '6px', fontWeight: 700, fontSize: '0.85rem' }}
                            >
                                <Download size={15} aria-hidden="true" />
                                Shipping CSV
                            </button>
                            <button
                                type="button"
                                onClick={() => loadOrders()}
                                disabled={ordersLoading}
                                style={{ background: 'var(--color-dark)', color: 'white', padding: '0.35rem 0.6rem', borderRadius: '6px', fontWeight: 700, fontSize: '0.85rem' }}
                            >
                                {ordersLoading ? 'Refreshing…' : 'Refresh'}
                            </button>
                        </div>
                    </div>

                    {ordersError ? (
                        <div style={{ fontSize: '0.9rem', color: '#a40000', marginBottom: '0.75rem' }}>{ordersError}</div>
                    ) : null}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', color: '#55463d', fontWeight: 800 }}>
                            Filter
                            <select
                                value={orderFilter}
                                onChange={(e) => {
                                    const nextFilter = e.target.value;
                                    setOrderFilter(nextFilter);
                                    loadOrders(nextFilter);
                                }}
                                disabled={ordersLoading}
                                style={{ padding: '0.35rem 0.5rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.85rem', background: 'white' }}
                            >
                                {ORDER_FILTER_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                        <div style={{ fontSize: '0.82rem', color: '#666' }}>
                            {orders.length} loaded
                        </div>
                    </div>

                    <div style={{ display: 'grid', gap: '0.75rem', maxHeight: '520px', overflow: 'auto' }}>
                        {orders.length === 0 ? (
                            <div style={{ background: 'white', border: '1px solid #eee', borderRadius: '8px', padding: '0.75rem', color: '#777' }}>
                                No orders match this filter.
                            </div>
                        ) : (
                            orders.map((order) => {
                                const primaryItem = order.items?.[0];
                                const refundableMinor = Number(order.amountTotal || 0) - Number(order.refundedAmount || 0);
                                const pendingRequests = (order.refundRequests || []).filter((request) => request.status === 'submitted');
                                const approvedRequests = (order.refundRequests || []).filter((request) => request.status === 'approved');
                                const shippable = isShippableOrder(order);
                                const digitalDeliveryLinks = order.digitalDelivery?.links || [];
                                const hasDigitalDeliveryControls =
                                    order.orderType === 'digital' ||
                                    order.orderType === 'mixed' ||
                                    digitalDeliveryLinks.length > 0;

                                return (
                                    <article
                                        key={order.id}
                                        style={{
                                            background: 'white',
                                            border: '1px solid #eee',
                                            borderRadius: '8px',
                                            padding: '0.75rem',
                                        }}
                                    >
                                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr auto', gap: '0.75rem', alignItems: 'start' }}>
                                            <div>
                                                <div style={{ fontWeight: 900 }}>{order.productName}</div>
                                                <div style={{ fontSize: '0.82rem', color: '#666', marginTop: '0.15rem' }}>
                                                    {order.id}
                                                </div>
                                                <div style={{ fontSize: '0.86rem', color: '#444', marginTop: '0.35rem' }}>
                                                    {primaryItem?.variantName ? `${primaryItem.variantName} · ` : ''}
                                                    {order.customerEmail || order.shippingEmail || 'no email'}
                                                </div>
                                                {(order.items || []).length > 0 ? (
                                                    <div style={{ display: 'grid', gap: '0.25rem', marginTop: '0.5rem', fontSize: '0.82rem', color: '#475569' }}>
                                                        {order.items.map((item) => (
                                                            <div key={item.id || `${item.productSlug}-${item.variantCode || 'digital'}`}>
                                                                {item.quantity}x {item.productName}
                                                                {item.variantName ? ` · ${item.variantName}` : ''}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : null}
                                                <div style={{ fontSize: '0.82rem', color: '#666', marginTop: '0.25rem' }}>
                                                    Paid: {formatDateTime(order.paidAt)} · Status: {order.status} / {order.fulfillmentStatus || '—'}
                                                </div>
                                                {order.shippingAddressLine1 ? (
                                                    <div style={{ fontSize: '0.82rem', color: '#666', marginTop: '0.25rem' }}>
                                                        Ship: {order.shippingAddressLine1}, {order.shippingPostalCode} {order.shippingCity}, {order.shippingCountry}
                                                    </div>
                                                ) : null}
                                                {shippable ? (
                                                    <div style={{ marginTop: '0.6rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', padding: '0.6rem', display: 'grid', gap: '0.35rem' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', alignItems: 'center' }}>
                                                            <strong style={{ fontSize: '0.82rem' }}>Packeta details</strong>
                                                            <button
                                                                type="button"
                                                                onClick={() => copyPacketaDetails(order)}
                                                                style={{ background: 'white', color: '#334155', border: '1px solid #cbd5e1', padding: '0.25rem 0.45rem', borderRadius: '6px', fontWeight: 800, fontSize: '0.72rem' }}
                                                            >
                                                                Copy
                                                            </button>
                                                        </div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.25rem 0.6rem', fontSize: '0.78rem', color: '#475569' }}>
                                                            <span><strong>Name:</strong> {order.shippingName || order.customerName || '—'}</span>
                                                            <span><strong>Phone:</strong> {order.shippingPhone || '—'}</span>
                                                            <span><strong>Email:</strong> {order.shippingEmail || order.customerEmail || '—'}</span>
                                                            <span><strong>Country:</strong> {order.shippingCountry || '—'}</span>
                                                            <span><strong>Street:</strong> {order.shippingAddressLine1 || '—'}</span>
                                                            <span><strong>City:</strong> {order.shippingCity || '—'}</span>
                                                            <span><strong>ZIP:</strong> {order.shippingPostalCode || '—'}</span>
                                                            {order.shippingAddressLine2 ? <span><strong>Line 2:</strong> {order.shippingAddressLine2}</span> : null}
                                                        </div>
                                                        {order.trackingNumber ? (
                                                            <div style={{ fontSize: '0.78rem', color: '#166534', fontWeight: 800 }}>
                                                                Tracking: {order.carrier || 'Carrier'} · {order.trackingNumber}
                                                                {order.trackingUrl ? (
                                                                    <>
                                                                        {' · '}
                                                                        <a href={order.trackingUrl} target="_blank" rel="noreferrer" style={{ color: '#166534', textDecoration: 'underline' }}>open</a>
                                                                    </>
                                                                ) : null}
                                                                {order.shippedAt ? ` · shipped ${formatDateTime(order.shippedAt)}` : ''}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                ) : null}
                                                {hasDigitalDeliveryControls ? (
                                                    <div style={{ marginTop: '0.6rem', border: '1px solid #dbe9df', borderRadius: '8px', background: '#f7fcf8', padding: '0.6rem', display: 'grid', gap: '0.5rem' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                            <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', color: '#166534' }}>
                                                                <ShieldCheck size={16} />
                                                                Secure PDF delivery
                                                            </strong>
                                                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => resendDigitalDeliveryEmail(order)}
                                                                    disabled={busy}
                                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: 'white', color: '#166534', border: '1px solid #bbf7d0', padding: '0.25rem 0.45rem', borderRadius: '6px', fontWeight: 800, fontSize: '0.72rem' }}
                                                                >
                                                                    <Send size={13} />
                                                                    Resend
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => regenerateDigitalDeliveryEmail(order)}
                                                                    disabled={busy}
                                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: 'white', color: '#334155', border: '1px solid #cbd5e1', padding: '0.25rem 0.45rem', borderRadius: '6px', fontWeight: 800, fontSize: '0.72rem' }}
                                                                >
                                                                    <RefreshCw size={13} />
                                                                    Regenerate
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => revokeDigitalDeliveryLinks(order)}
                                                                    disabled={busy || digitalDeliveryLinks.length === 0}
                                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: 'white', color: '#a40000', border: '1px solid #f3c5cd', padding: '0.25rem 0.45rem', borderRadius: '6px', fontWeight: 800, fontSize: '0.72rem' }}
                                                                >
                                                                    <Ban size={13} />
                                                                    Revoke
                                                                </button>
                                                            </div>
                                                        </div>
                                                        {digitalDeliveryLinks.length === 0 ? (
                                                            <div style={{ fontSize: '0.78rem', color: '#475569' }}>
                                                                No delivery links recorded yet.
                                                            </div>
                                                        ) : (
                                                            <div style={{ display: 'grid', gap: '0.4rem' }}>
                                                                {digitalDeliveryLinks.map((link) => (
                                                                    <div key={link.id} style={{ borderTop: '1px dashed #cfe7d5', paddingTop: '0.4rem', fontSize: '0.78rem', color: '#475569' }}>
                                                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                                            <span><strong>{link.filename}</strong></span>
                                                                            <span style={{ fontWeight: 900, color: link.status === 'available' ? '#166534' : '#8a1c2b' }}>{link.status}</span>
                                                                        </div>
                                                                        <div style={{ marginTop: '0.2rem' }}>
                                                                            {link.maxDownloads == null
                                                                                ? `${link.downloadCount} downloads · unlimited · permanent`
                                                                                : `${link.downloadCount}/${link.maxDownloads} downloads`}
                                                                            {link.emailSentAt ? ` · email ${formatDateTime(link.emailSentAt)}` : ' · email pending'}
                                                                            {link.revokedAt ? ` · revoked ${formatDateTime(link.revokedAt)}` : ''}
                                                                        </div>
                                                                        {(link.recentEvents || []).length > 0 ? (
                                                                            <div style={{ marginTop: '0.2rem', color: '#64748b' }}>
                                                                                Last event: {link.recentEvents[0].eventType} · {formatDateTime(link.recentEvents[0].createdAt)}
                                                                            </div>
                                                                        ) : null}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontWeight: 900 }}>{formatMoneyMinor(order.amountTotal, order.currency)}</div>
                                                <div style={{ fontSize: '0.8rem', color: '#666' }}>
                                                    Refunded: {formatMoneyMinor(order.refundedAmount, order.currency)}
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: '#666' }}>
                                                    Refund status: {order.refundStatus || 'none'}
                                                </div>
                                            </div>
                                        </div>

                                        {(order.refundRequests || []).length > 0 && (
                                            <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                                                {order.refundRequests.map((request) => (
                                                    <div
                                                        key={request.id}
                                                        style={{
                                                            border: '1px solid #f1d7bd',
                                                            borderRadius: '8px',
                                                            padding: '0.65rem',
                                                            background: '#fff7ed',
                                                            display: 'grid',
                                                            gridTemplateColumns: '1fr auto',
                                                            gap: '0.75rem',
                                                        }}
                                                    >
                                                        <div>
                                                            <div style={{ fontWeight: 800, fontSize: '0.88rem' }}>
                                                                Refund request #{request.id} · {request.status}
                                                            </div>
                                                            <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.2rem' }}>
                                                                {request.requestType} · {request.customerEmail} · {formatDateTime(request.createdAt)}
                                                            </div>
                                                            {request.customerReason || request.customerNotes ? (
                                                                <div style={{ fontSize: '0.82rem', color: '#444', marginTop: '0.35rem' }}>
                                                                    {request.customerReason || request.customerNotes}
                                                                </div>
                                                            ) : null}
                                                            {request.adminReason ? (
                                                                <div style={{ fontSize: '0.8rem', color: '#555', marginTop: '0.35rem' }}>
                                                                    Admin: {request.adminReason}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                                            {request.status === 'submitted' && (
                                                                <>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => reviewRefundRequest(request, 'approved')}
                                                                        disabled={busy}
                                                                        style={{ background: '#ecfdf5', color: '#166534', padding: '0.35rem 0.55rem', borderRadius: '6px', fontWeight: 800, fontSize: '0.78rem' }}
                                                                    >
                                                                        Approve
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => reviewRefundRequest(request, 'rejected')}
                                                                        disabled={busy}
                                                                        style={{ background: '#fff0f0', color: '#a40000', padding: '0.35rem 0.55rem', borderRadius: '6px', fontWeight: 800, fontSize: '0.78rem' }}
                                                                    >
                                                                        Reject
                                                                    </button>
                                                                </>
                                                            )}
                                                            {request.status === 'approved' && refundableMinor > 0 && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => createAdminRefund(order, request)}
                                                                    disabled={busy}
                                                                    style={{ background: '#341320', color: 'white', padding: '0.35rem 0.55rem', borderRadius: '6px', fontWeight: 800, fontSize: '0.78rem' }}
                                                                >
                                                                    Refund
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {(order.auditEvents || []).length > 0 ? (
                                            <details style={{ marginTop: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', padding: '0.6rem' }}>
                                                <summary style={{ cursor: 'pointer', fontWeight: 900, fontSize: '0.82rem', color: '#334155' }}>
                                                    Audit log ({order.auditEvents.length})
                                                </summary>
                                                <div style={{ display: 'grid', gap: '0.45rem', marginTop: '0.6rem' }}>
                                                    {order.auditEvents.map((event) => (
                                                        <div key={event.id} style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '0.45rem' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                                                                <strong style={{ fontSize: '0.78rem', color: '#1f2937' }}>{event.eventType}</strong>
                                                                <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{formatDateTime(event.createdAt)}</span>
                                                            </div>
                                                            {event.eventNote ? (
                                                                <div style={{ marginTop: '0.2rem', fontSize: '0.76rem', color: '#475569', overflowWrap: 'anywhere' }}>
                                                                    {event.eventNote}
                                                                </div>
                                                            ) : null}
                                                            {event.metadata ? (
                                                                <div style={{ marginTop: '0.2rem', fontSize: '0.72rem', color: '#64748b', overflowWrap: 'anywhere' }}>
                                                                    {JSON.stringify(event.metadata)}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    ))}
                                                </div>
                                            </details>
                                        ) : null}

                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                                            {pendingRequests.length > 0 ? (
                                                <span style={{ fontSize: '0.78rem', color: '#7a3f00', fontWeight: 800 }}>
                                                    {pendingRequests.length} request(s) need review
                                                </span>
                                            ) : null}
                                            {approvedRequests.length > 0 ? (
                                                <span style={{ fontSize: '0.78rem', color: '#166534', fontWeight: 800 }}>
                                                    {approvedRequests.length} approved refund request(s)
                                                </span>
                                            ) : null}
                                            {refundableMinor > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => createAdminRefund(order)}
                                                    disabled={busy}
                                                    style={{ background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', padding: '0.35rem 0.55rem', borderRadius: '6px', fontWeight: 800, fontSize: '0.78rem' }}
                                                >
                                                    Manual refund override
                                                </button>
                                            )}
                                            {shippable && ['paid', 'fulfilled'].includes(order.status) ? (
                                                <button
                                                    type="button"
                                                    onClick={() => markOrderShipped(order)}
                                                    disabled={busy}
                                                    style={{ background: '#ecfdf5', color: '#166534', border: '1px solid #bbf7d0', padding: '0.35rem 0.55rem', borderRadius: '6px', fontWeight: 800, fontSize: '0.78rem' }}
                                                >
                                                    {order.shippedAt ? 'Update tracking' : 'Mark shipped / tracking'}
                                                </button>
                                            ) : null}
                                        </div>
                                    </article>
                                );
                            })
                        )}
                    </div>
                </div>
                    </>
                ) : isCouponsSection ? (
                    <AdminCouponsSection />
                ) : isMarketingSection ? (
                    <MarketingEmailSection />
                ) : isProductsSection ? (
                    <ProductCmsSection />
                ) : isMembershipSection ? (
                    <MembershipAdminSection />
                ) : (
                !selectedPost ? (
                    <div style={{ padding: '1rem' }}>No post selected.</div>
                ) : (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                            <h2 style={{ marginBottom: 0 }}>Edit post</h2>
                            <button
                                onClick={deleteSelected}
                                disabled={busy}
                                style={{ background: '#fff0f0', color: '#a40000', padding: '0.5rem 0.75rem', borderRadius: '6px', fontWeight: 700 }}
                            >
                                Delete
                            </button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <span style={{ fontSize: '0.85rem', color: '#666' }}>Title *</span>
                                <input
                                    value={selectedPost.title}
                                    onChange={(e) => {
                                        const title = e.target.value;
                                        const autoSlug = selectedPost.slug?.trim() ? selectedPost.slug : slugify(title);
                                        updateSelected({ title, slug: autoSlug });
                                    }}
                                    style={{ padding: '0.6rem 0.75rem', border: '1px solid #eee', borderRadius: '8px' }}
                                />
                            </label>

                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <span style={{ fontSize: '0.85rem', color: '#666' }}>Slug *</span>
                                <input
                                    value={selectedPost.slug}
                                    onChange={(e) => updateSelected({ slug: slugify(e.target.value) })}
                                    style={{ padding: '0.6rem 0.75rem', border: '1px solid #eee', borderRadius: '8px' }}
                                />
                            </label>

                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', gridColumn: '1 / -1' }}>
                                <span style={{ fontSize: '0.85rem', color: '#666' }}>Excerpt</span>
                                <input
                                    value={selectedPost.excerpt}
                                    onChange={(e) => updateSelected({ excerpt: e.target.value })}
                                    style={{ padding: '0.6rem 0.75rem', border: '1px solid #eee', borderRadius: '8px' }}
                                />
                            </label>

                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <span style={{ fontSize: '0.85rem', color: '#666' }}>Category</span>
                                <select
                                    value={selectedPost.categoryId ?? ''}
                                    onChange={(e) => {
                                        const id = e.target.value ? Number(e.target.value) : null;
                                        const cat = categories.find(c => c.id === id);
                                        updateSelected({ categoryId: id, category: cat?.name || '' });
                                    }}
                                    style={{ padding: '0.6rem 0.75rem', border: '1px solid #eee', borderRadius: '8px' }}
                                >
                                    <option value="">—</option>
                                    {categories.map((c) => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </label>

                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <span style={{ fontSize: '0.85rem', color: '#666' }}>Date</span>
                                <input
                                    type="date"
                                    value={selectedPost.date || ''}
                                    onChange={(e) => updateSelected({ date: e.target.value })}
                                    style={{ padding: '0.6rem 0.75rem', border: '1px solid #eee', borderRadius: '8px' }}
                                />
                            </label>

                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <span style={{ fontSize: '0.85rem', color: '#666' }}>Author</span>
                                <input
                                    value={selectedPost.author}
                                    onChange={(e) => updateSelected({ author: e.target.value })}
                                    style={{ padding: '0.6rem 0.75rem', border: '1px solid #eee', borderRadius: '8px' }}
                                />
                            </label>

                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <span style={{ fontSize: '0.85rem', color: '#666' }}>Image URL or /public path</span>
                                <input
                                    value={selectedPost.image}
                                    onChange={(e) => updateSelected({ image: e.target.value })}
                                    style={{ padding: '0.6rem 0.75rem', border: '1px solid #eee', borderRadius: '8px' }}
                                />
                            </label>

                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', gridColumn: '1 / -1' }}>
                                <input
                                    type="checkbox"
                                    checked={selectedPost.hasFaq || false}
                                    onChange={(e) => updateSelected({ hasFaq: e.target.checked })}
                                    style={{ width: '18px', height: '18px' }}
                                />
                                <span style={{ fontSize: '0.9rem', color: '#333', fontWeight: 600 }}>Enable FAQ section</span>
                            </label>
                        </div>

                        {selectedPost.hasFaq && (
                            <div style={{ marginTop: '1rem', padding: '1rem', background: '#f9f9f9', borderRadius: '8px', border: '1px solid #eee' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                                    <span style={{ fontSize: '0.9rem', color: '#333', fontWeight: 700 }}>FAQ Items</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const newItems = [...(selectedPost.faqItems || []), { question: '', answer: '' }];
                                            updateSelected({ faqItems: newItems });
                                        }}
                                        style={{ background: 'var(--color-primary)', color: 'white', padding: '0.4rem 0.65rem', borderRadius: '6px', fontWeight: 700, fontSize: '0.85rem' }}
                                    >
                                        + Add FAQ
                                    </button>
                                </div>
                                {(selectedPost.faqItems || []).length === 0 && (
                                    <div style={{ fontSize: '0.85rem', color: '#888', fontStyle: 'italic' }}>No FAQ items yet. Click "+ Add FAQ" to add one.</div>
                                )}
                                {(selectedPost.faqItems || []).map((faq, index) => (
                                    <div key={index} style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'white', borderRadius: '6px', border: '1px solid #ddd' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                            <span style={{ fontSize: '0.8rem', color: '#666', fontWeight: 600 }}>FAQ #{index + 1}</span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const newItems = selectedPost.faqItems.filter((_, i) => i !== index);
                                                    updateSelected({ faqItems: newItems });
                                                }}
                                                style={{ background: '#fff0f0', color: '#a40000', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: 600, fontSize: '0.75rem' }}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.5rem' }}>
                                            <span style={{ fontSize: '0.8rem', color: '#666' }}>Question</span>
                                            <input
                                                value={faq.question}
                                                onChange={(e) => {
                                                    const newItems = [...selectedPost.faqItems];
                                                    newItems[index] = { ...newItems[index], question: e.target.value };
                                                    updateSelected({ faqItems: newItems });
                                                }}
                                                placeholder="Enter the question..."
                                                style={{ padding: '0.5rem 0.65rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.9rem' }}
                                            />
                                        </label>
                                        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <span style={{ fontSize: '0.8rem', color: '#666' }}>Answer</span>
                                            <textarea
                                                value={faq.answer}
                                                onChange={(e) => {
                                                    const newItems = [...selectedPost.faqItems];
                                                    newItems[index] = { ...newItems[index], answer: e.target.value };
                                                    updateSelected({ faqItems: newItems });
                                                }}
                                                placeholder="Enter the answer..."
                                                rows={3}
                                                style={{ padding: '0.5rem 0.65rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.9rem', resize: 'vertical' }}
                                            />
                                        </label>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                            <div>
                                <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.35rem' }}>Markdown *</div>
                                <div style={{ fontSize: '0.82rem', color: '#6f3f46', marginBottom: '0.6rem', lineHeight: 1.45 }}>
                                    Obsah článku sa vytvorí automaticky z hlavných nadpisov <code>## Nadpis</code>.
                                    {' '}V náhľade je teraz {selectedPostTocHeadings.length} {selectedPostTocHeadings.length === 1 ? 'položka' : 'položiek'}.
                                </div>
                                <textarea
                                    value={selectedPost.content}
                                    onChange={(e) => updateSelected({ content: e.target.value })}
                                    rows={16}
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem',
                                        border: '1px solid #eee',
                                        borderRadius: '8px',
                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                                        fontSize: '0.95rem',
                                    }}
                                />
                            </div>

                            <div>
                                <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.35rem' }}>Preview</div>
                                <div style={{
                                    border: '1px solid #eee',
                                    borderRadius: '8px',
                                    padding: '0.75rem',
                                    minHeight: '420px',
                                    background: 'var(--color-background)'
                                }}>
                                    <MarkdownContent markdown={selectedPost.content} />
                                </div>
                            </div>
                        </div>
                    </>
                )
                )}
            </section>
        </div>
    );
};

export default Admin;
