import { getCheckoutAttribution } from '../utils/attribution';
import {
    clearMembershipSession,
    getMembershipSessionToken,
    storeMembershipSession,
} from '../utils/membershipAuth';
import {
    checkoutAttemptFields,
    markCheckoutAttemptCreated,
    prepareCheckoutAttempt,
} from '../checkout/attemptStore';

// No runtime app-config.js dependency.
// - Dev default: relative "/api" so Vite proxy avoids browser CORS.
// - Production default: hardcoded backend URL.
// - Production override: VITE_API_BASE_URL.
// - Dev override is intentionally opt-in to avoid stale shell env breaking local work.
const envBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const useDevApiOverride = import.meta.env.VITE_USE_API_BASE_URL_IN_DEV === 'true';
const baseUrl = import.meta.env.DEV
    ? (useDevApiOverride ? envBaseUrl : '')
    : (envBaseUrl || 'https://zajky.zentrobot.io');

export const apiUrl = (path) => {
    if (!path.startsWith('/')) path = `/${path}`;
    if (!baseUrl) return path;
    return `${baseUrl}${path}`;
};

export const apiFetch = async (path, options = {}) => {
    const memberSessionToken = path.startsWith('/api/membership')
        ? getMembershipSessionToken()
        : '';
    const res = await fetch(apiUrl(path), {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(memberSessionToken ? { Authorization: `Bearer ${memberSessionToken}` } : {}),
            ...(options.headers || {}),
        },
        credentials: 'include',
    });

    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = null;
    }

    if (!res.ok) {
        const err = new Error(data?.error || `http_${res.status}`);
        err.status = res.status;
        err.data = data;
        err.url = apiUrl(path);
        err.bodyText = text;
        throw err;
    }

    return data;
};

export const createCheckoutSession = async (productSlug, options = {}) => {
    const attribution = options.attribution || getCheckoutAttribution();
    const checkoutPayload = {
        productSlug,
        ...(options.variantCode ? { variantCode: options.variantCode } : {}),
        ...(options.quantity ? { quantity: options.quantity } : {}),
        ...(options.couponCode ? { couponCode: options.couponCode } : {}),
        ...(options.claimToken || options.discountToken
            ? { claimToken: options.claimToken || options.discountToken }
            : {}),
    };
    const { attempt, superseded } = await prepareCheckoutAttempt({
        kind: 'single',
        scope: `single:${productSlug}`,
        payload: checkoutPayload,
    });
    if (superseded) await cancelCheckoutAttempt(superseded.id, superseded.token);
    const data = await apiFetch('/api/stripe/checkout-session', {
        method: 'POST',
        body: JSON.stringify({
            ...checkoutPayload,
            attribution,
            ...checkoutAttemptFields(attempt),
        }),
    });

    if (!data?.checkoutUrl && !data?.checkoutPageUrl) {
        throw new Error('missing_checkout_bootstrap');
    }
    markCheckoutAttemptCreated(attempt);
    return data;
};

export const createCartCheckoutSession = async (items, options = {}) => {
    const attribution = options.attribution || getCheckoutAttribution();
    const checkoutPayload = {
        items,
        ...(options.couponCode ? { couponCode: options.couponCode } : {}),
        ...(options.claimToken ? { claimToken: options.claimToken } : {}),
    };
    const { attempt, superseded } = await prepareCheckoutAttempt({
        kind: 'cart',
        scope: 'cart',
        payload: checkoutPayload,
    });
    if (superseded) await cancelCheckoutAttempt(superseded.id, superseded.token);
    const data = await apiFetch('/api/stripe/cart-checkout-session', {
        method: 'POST',
        body: JSON.stringify({
            ...checkoutPayload,
            attribution,
            ...checkoutAttemptFields(attempt),
        }),
    });

    if (!data?.checkoutUrl && !data?.checkoutPageUrl) {
        throw new Error('missing_checkout_bootstrap');
    }
    markCheckoutAttemptCreated(attempt);
    return data;
};

export const quoteCheckout = async (items, options = {}) => {
    const data = await apiFetch('/api/coupons/quote', {
        method: 'POST',
        body: JSON.stringify({
            items,
            ...(options.couponCode ? { couponCode: options.couponCode } : {}),
            ...(options.claimToken ? { claimToken: options.claimToken } : {}),
        }),
    });
    return data?.quote || null;
};

export const loadAdminCoupons = async ({ search = '', state = 'all' } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (state && state !== 'all') params.set('state', state);
    const data = await apiFetch(`/api/coupons/admin${params.size ? `?${params}` : ''}`);
    return { coupons: data?.coupons || [], stateCounts: data?.stateCounts || {} };
};

export const loadAdminCoupon = async (couponId) =>
    apiFetch(`/api/coupons/admin/${encodeURIComponent(couponId)}`);

export const createAdminCoupon = async (payload) =>
    apiFetch('/api/coupons/admin', { method: 'POST', body: JSON.stringify(payload) });

export const updateAdminCoupon = async (couponId, payload) =>
    apiFetch(`/api/coupons/admin/${encodeURIComponent(couponId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    });

export const runAdminCouponAction = async (couponId, action, payload = {}) =>
    apiFetch(`/api/coupons/admin/${encodeURIComponent(couponId)}/${action}`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });

export const loadAdminMarketingWorkspace = async () => {
    const data = await apiFetch('/api/marketing/admin');
    return {
        audience: data?.audience || { total: 0, active: 0, excluded: 0, guide: 0, discount: 0 },
        campaigns: data?.campaigns || [],
    };
};

export const loadAdminMarketingCampaign = async (campaignId) => {
    const data = await apiFetch(`/api/marketing/admin/${encodeURIComponent(campaignId)}`);
    return data?.campaign || null;
};

export const createAdminMarketingCampaign = async (payload = {}) => {
    const data = await apiFetch('/api/marketing/admin', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    return data?.campaign || null;
};

export const updateAdminMarketingCampaign = async (campaignId, payload) => {
    const data = await apiFetch(`/api/marketing/admin/${encodeURIComponent(campaignId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    });
    return data?.campaign || null;
};

export const uploadAdminMarketingAttachment = async (campaignId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const path = `/api/marketing/admin/${encodeURIComponent(campaignId)}/attachments`;
    const res = await fetch(apiUrl(path), {
        method: 'POST',
        body: formData,
        credentials: 'include',
    });
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = null;
    }
    if (!res.ok) {
        const error = new Error(data?.error || `http_${res.status}`);
        error.status = res.status;
        error.data = data;
        throw error;
    }
    return data?.attachment || null;
};

export const deleteAdminMarketingAttachment = async (campaignId, attachmentId) =>
    apiFetch(`/api/marketing/admin/${encodeURIComponent(campaignId)}/attachments/${encodeURIComponent(attachmentId)}`, {
        method: 'DELETE',
    });

export const sendAdminMarketingTest = async (campaignId, email) =>
    apiFetch(`/api/marketing/admin/${encodeURIComponent(campaignId)}/test`, {
        method: 'POST',
        body: JSON.stringify({ email }),
    });

export const queueAdminMarketingCampaign = async (campaignId, confirmation) => {
    const data = await apiFetch(`/api/marketing/admin/${encodeURIComponent(campaignId)}/send`, {
        method: 'POST',
        body: JSON.stringify({ confirmation }),
    });
    return data?.campaign || null;
};

export const retryAdminMarketingCampaign = async (campaignId) => {
    const data = await apiFetch(`/api/marketing/admin/${encodeURIComponent(campaignId)}/retry`, {
        method: 'POST',
        body: JSON.stringify({}),
    });
    return data?.campaign || null;
};

export const signupForWelcomeDiscount = async ({ email, consentAccepted, source, incentive }) => {
    return apiFetch('/api/newsletter/discount-signup', {
        method: 'POST',
        body: JSON.stringify({
            email,
            consentAccepted,
            source,
            ...(incentive ? { incentive } : {}),
        }),
    });
};

export const loadWelcomeDiscountOffer = async () => {
    const data = await apiFetch('/api/newsletter/discount-offer');
    return data?.offer || null;
};

export const loadProducts = async () => {
    const data = await apiFetch('/api/products');
    return data?.products || [];
};

export const loadProduct = async (slug) => {
    const data = await apiFetch(`/api/products/${encodeURIComponent(slug)}`);
    return data?.product || null;
};

export const loadVisitorCountry = async () => {
    const data = await apiFetch('/api/geo');
    return data?.countryCode || '';
};

export const loadMembershipOffer = async () => {
    const data = await apiFetch('/api/membership/offer');
    return data?.offer || null;
};

export const loadMembershipMemberCount = async () => {
    const data = await apiFetch('/api/membership/member-count');
    return Number.isFinite(Number(data?.memberCount)) ? Number(data.memberCount) : 0;
};

export const loadDiscussionThreads = async ({ limit = 20, offset = 0 } = {}) => {
    const data = await apiFetch(`/api/membership/discussions?${new URLSearchParams({ limit: String(limit), offset: String(offset) })}`);
    return { threads: data?.threads || [], nextOffset: data?.nextOffset ?? null };
};
export const loadDiscussionThread = async (threadId) => (await apiFetch(`/api/membership/discussions/${encodeURIComponent(threadId)}`))?.thread || null;
export const loadDiscussionReplies = async (threadId, { limit = 20, offset = 0 } = {}) => {
    const data = await apiFetch(`/api/membership/discussions/${encodeURIComponent(threadId)}/replies?${new URLSearchParams({ limit: String(limit), offset: String(offset) })}`);
    return { replies: data?.replies || [], nextOffset: data?.nextOffset ?? null };
};
export const createDiscussionThread = async ({ title, body }) => (await apiFetch('/api/membership/discussions', { method: 'POST', body: JSON.stringify({ title, body }) }))?.thread || null;
export const createDiscussionReply = async ({ threadId, body }) => (await apiFetch(`/api/membership/discussions/${encodeURIComponent(threadId)}/replies`, { method: 'POST', body: JSON.stringify({ body }) }))?.reply || null;

export const createMembershipCheckout = async (email, plan = 'monthly') => {
    const membershipPlan = plan === 'annual' ? 'annual' : 'monthly';
    const { attempt, superseded } = await prepareCheckoutAttempt({
        kind: 'membership',
        scope: 'membership',
        payload: {
            email: String(email || '').trim().toLowerCase(),
            plan: membershipPlan,
        },
    });
    if (superseded) await cancelCheckoutAttempt(superseded.id, superseded.token);
    const data = await apiFetch('/api/membership/checkout', {
        method: 'POST',
        body: JSON.stringify({ email, plan: membershipPlan, ...checkoutAttemptFields(attempt) }),
    });
    if (!data?.checkoutUrl && !data?.checkoutPageUrl) throw new Error('missing_checkout_bootstrap');
    markCheckoutAttemptCreated(attempt);
    return data;
};

export const loadCheckoutAttempt = (attemptId, attemptToken) =>
    apiFetch(`/api/checkout/attempts/${encodeURIComponent(attemptId)}`, {
        headers: { 'X-Checkout-Attempt-Token': attemptToken },
    });

export const saveCheckoutCustomer = ({ attemptId, attemptToken, customer }) =>
    apiFetch(`/api/checkout/attempts/${encodeURIComponent(attemptId)}/customer`, {
        method: 'PUT',
        headers: { 'X-Checkout-Attempt-Token': attemptToken },
        body: JSON.stringify(customer),
    });

export const mutateCheckoutAttemptCoupon = ({
    attemptId,
    attemptToken,
    action,
    couponCode = '',
    claimToken = '',
    mutationId,
}) => apiFetch(`/api/checkout/attempts/${encodeURIComponent(attemptId)}/coupon`, {
    method: 'POST',
    headers: { 'X-Checkout-Attempt-Token': attemptToken },
    body: JSON.stringify({
        action,
        mutationId,
        ...(action === 'apply' ? { couponCode, ...(claimToken ? { claimToken } : {}) } : {}),
    }),
});

export const cancelCheckoutAttempt = (attemptId, attemptToken) =>
    apiFetch(`/api/checkout/attempts/${encodeURIComponent(attemptId)}/cancel`, {
        method: 'POST',
        headers: { 'X-Checkout-Attempt-Token': attemptToken },
        body: JSON.stringify({}),
    });

export const recordCheckoutReturn = (attemptId, attemptToken) =>
    apiFetch(`/api/checkout/attempts/${encodeURIComponent(attemptId)}/return`, {
        method: 'POST',
        headers: { 'X-Checkout-Attempt-Token': attemptToken },
        body: JSON.stringify({}),
    });

export const loadMembershipSession = async () => {
    const data = await apiFetch('/api/membership/me');
    if (!data?.isAuthenticated) clearMembershipSession();
    return data;
};

export const requestMembershipCode = async (email) =>
    apiFetch('/api/membership/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email }),
    });

export const verifyMembershipCode = async ({ email, code }) => {
    const data = await apiFetch('/api/membership/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
    });
    if (data?.memberSessionToken && data?.memberSessionExpiresAt) {
        storeMembershipSession({
            token: data.memberSessionToken,
            expiresAt: data.memberSessionExpiresAt,
        });
    }
    return data;
};

export const logoutMembership = async () => {
    try {
        return await apiFetch('/api/membership/auth/logout', { method: 'POST' });
    } finally {
        clearMembershipSession();
    }
};

export const loadMembershipContent = async () => {
    const data = await apiFetch('/api/membership/content');
    return data?.content || [];
};

export const loadMembershipCategories = async () => {
    const data = await apiFetch('/api/membership/categories');
    return data?.categories || [];
};

export const loadMembershipPosts = async ({
    cursor = '',
    q = '',
    category = '',
    type = '',
    saved = false,
    limit = 12,
} = {}) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    if (type) params.set('type', type);
    if (saved) params.set('saved', '1');
    params.set('limit', String(limit));
    const data = await apiFetch(`/api/membership/posts?${params.toString()}`);
    return {
        access: data?.access || 'preview',
        posts: data?.posts || [],
        nextCursor: data?.nextCursor || null,
    };
};

export const loadMembershipPost = async (slug) => {
    const data = await apiFetch(`/api/membership/posts/${encodeURIComponent(slug)}`);
    return {
        access: data?.access || 'preview',
        post: data?.post || null,
    };
};

export const setMembershipPostSaved = async ({ postId, saved }) =>
    apiFetch(`/api/membership/posts/${encodeURIComponent(postId)}/saved`, {
        method: saved ? 'PUT' : 'DELETE',
    });

export const loadMembershipComments = async (postId) => {
    const data = await apiFetch(
        `/api/membership/posts/${encodeURIComponent(postId)}/comments`
    );
    return data?.comments || [];
};

export const createMembershipComment = async ({ postId, body, parentCommentId = null }) => {
    const data = await apiFetch(
        `/api/membership/posts/${encodeURIComponent(postId)}/comments`,
        {
            method: 'POST',
            body: JSON.stringify({ body, parentCommentId }),
        }
    );
    return data?.comment || null;
};

export const deleteMembershipComment = async (commentId) =>
    apiFetch(`/api/membership/comments/${encodeURIComponent(commentId)}`, {
        method: 'DELETE',
    });

export const recordMembershipPostEvent = async ({
    postId,
    eventType,
    assetId = null,
    metadata = null,
}) =>
    apiFetch(`/api/membership/posts/${encodeURIComponent(postId)}/events`, {
        method: 'POST',
        body: JSON.stringify({ eventType, assetId, metadata }),
    });

export const membershipMediaUrl = (path) =>
    path ? apiUrl(path) : '';

export const downloadMembershipPostAsset = async ({ url, filename }) => {
    const memberSessionToken = getMembershipSessionToken();
    const res = await fetch(apiUrl(url), {
        method: 'GET',
        credentials: 'include',
        headers: memberSessionToken
            ? { Authorization: `Bearer ${memberSessionToken}` }
            : {},
    });
    if (!res.ok) {
        const text = await res.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = null;
        }
        const error = new Error(data?.error || `http_${res.status}`);
        error.status = res.status;
        error.data = data;
        throw error;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename || 'zajkologia-file';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
};

export const createMembershipBillingPortal = async () => {
    const data = await apiFetch('/api/membership/billing-portal', { method: 'POST' });
    if (!data?.portalUrl) throw new Error('missing_billing_portal_url');
    return data;
};

export const downloadMembershipFile = async ({ contentId, filename }) => {
    const memberSessionToken = getMembershipSessionToken();
    const res = await fetch(apiUrl(`/api/membership/content/${encodeURIComponent(contentId)}/download`), {
        method: 'GET',
        credentials: 'include',
        headers: memberSessionToken
            ? { Authorization: `Bearer ${memberSessionToken}` }
            : {},
    });
    if (!res.ok) {
        const text = await res.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = null;
        }
        const error = new Error(data?.error || `http_${res.status}`);
        error.status = res.status;
        error.data = data;
        throw error;
    }

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename || 'zajkologia-file';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
};

const uploadProductAsset = async ({ productId, endpoint, file, fields = {} }) => {
    const formData = new FormData();
    formData.append('file', file);
    Object.entries(fields).forEach(([key, value]) => {
        if (value != null && value !== '') formData.append(key, value);
    });

    const res = await fetch(apiUrl(`/api/products/admin/${productId}/assets/${endpoint}`), {
        method: 'POST',
        body: formData,
        credentials: 'include',
    });

    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = null;
    }

    if (!res.ok) {
        const err = new Error(data?.error || `http_${res.status}`);
        err.status = res.status;
        err.data = data;
        err.url = apiUrl(`/api/products/admin/${productId}/assets/${endpoint}`);
        err.bodyText = text;
        throw err;
    }

    return data;
};

export const loadProductAssets = async (productId) => {
    const data = await apiFetch(`/api/products/admin/${productId}/assets`);
    return data?.assets || [];
};

export const deleteProductAsset = async (productId, assetId) => {
    return apiFetch(`/api/products/admin/${productId}/assets/${assetId}`, {
        method: 'DELETE',
    });
};

export const deleteProductImageAsset = deleteProductAsset;
export const deleteProductPdfAsset = deleteProductAsset;

export const uploadProductImage = async (productId, file, role = 'asset') => {
    const data = await uploadProductAsset({
        productId,
        endpoint: 'image',
        file,
        fields: { role },
    });

    return data?.asset || null;
};

export const uploadProductPdf = async (productId, file, { languageCode, customerFilename } = {}) => {
    const data = await uploadProductAsset({
        productId,
        endpoint: 'pdf',
        file,
        fields: {
            languageCode,
            customerFilename,
        },
    });

    return data;
};

export const loadDigitalDeliveryClaim = async (claimToken) => {
    const data = await apiFetch(`/api/digital-delivery/claim/${encodeURIComponent(claimToken)}`);
    return data?.summary || null;
};

export const sendDigitalDeliveryCode = async (claimToken) => {
    return apiFetch(`/api/digital-delivery/claim/${encodeURIComponent(claimToken)}/send-code`, {
        method: 'POST',
        body: JSON.stringify({}),
    });
};

export const verifyDigitalDeliveryCode = async (claimToken, code) => {
    return apiFetch(`/api/digital-delivery/claim/${encodeURIComponent(claimToken)}/verify`, {
        method: 'POST',
        body: JSON.stringify({ code }),
    });
};

const parseDownloadFilename = (contentDisposition, fallback) => {
    const header = String(contentDisposition || '');
    const encodedMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (encodedMatch?.[1]) {
        try {
            return decodeURIComponent(encodedMatch[1]);
        } catch {
            return fallback;
        }
    }

    const quotedMatch = header.match(/filename="([^"]+)"/i);
    return quotedMatch?.[1] || fallback;
};

export const downloadDigitalDeliveryFile = async ({ deliveryLinkId, sessionToken, filename }) => {
    const res = await fetch(apiUrl(`/api/digital-delivery/downloads/${encodeURIComponent(deliveryLinkId)}`), {
        method: 'GET',
        credentials: 'include',
        headers: {
            'X-Digital-Delivery-Session': sessionToken,
        },
    });

    if (!res.ok) {
        const text = await res.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = null;
        }
        const err = new Error(data?.error || `http_${res.status}`);
        err.status = res.status;
        err.data = data;
        throw err;
    }

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = parseDownloadFilename(res.headers.get('Content-Disposition'), filename || 'zajkologia.pdf');
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
};

const parseFaqContent = (faqContent) => {
    if (!faqContent) return [];
    try {
        const parsed = JSON.parse(faqContent);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const mapPostFromApi = (p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt || '',
    content: p.contentMd || '',
    categoryId: p.categoryId ?? null,
    category: p.category || '',
    image: p.imageUrl || '',
    author: p.author || '',
    date: p.date || '',
    hasFaq: Boolean(p.hasFaq),
    faqItems: parseFaqContent(p.faqContent),
});

export const loadPostSummaries = async () => {
    const data = await apiFetch('/api/posts?view=summary');
    return (data?.posts || []).map(mapPostFromApi);
};
