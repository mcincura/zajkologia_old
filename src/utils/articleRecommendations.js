export const ARTICLE_INTERESTS_STORAGE_KEY = 'zajkologia.articleInterests:v1';
export const ARTICLE_INTERESTS_CHANGED_EVENT = 'zajkologia:article-interests-changed';

const MAX_RECENT_ARTICLES = 12;
const MAX_CATEGORY_SCORE = 999;
const recordedViewKeys = new Set();

const EMPTY_PROFILE = Object.freeze({
  categories: Object.freeze({}),
  recentlyViewedArticles: Object.freeze([]),
});

const STOP_WORDS = new Set([
  'aby', 'ako', 'ale', 'alebo', 'ani', 'bez', 'bude', 'budu', 'co', 'do', 'ho', 'ich',
  'je', 'ked', 'kralik', 'kralika', 'kraliky', 'ma', 'mat', 'moze', 'na', 'nad', 'nie',
  'od', 'o', 'po', 'pod', 'pre', 'pri', 'sa', 'si', 'so', 'su', 'svoj', 'ta', 'tak',
  'to', 'uz', 'v', 'vo', 'z', 'za', 'zo', 'ze', 'tento', 'tato', 'ktory', 'ktora',
]);

const STEM_SUFFIXES = [
  'ovania', 'ovanie', 'eniami', 'aniami', 'enim', 'anim', 'enie', 'anie', 'ami', 'ach',
  'och', 'ove', 'ovi', 'ova', 'ovy', 'om', 'ou', 'ov', 'ie', 'ia', 'iu', 'y', 'i', 'a', 'u',
];

const TOPIC_GROUPS = {
  behaviour: [
    'agres', 'binky', 'domin', 'dup', 'frustr', 'komunik', 'naskak', 'rec tela', 'sprav',
    'strach', 'stres', 'teritor', 'znack',
  ],
  diet: [
    'granul', 'krm', 'ovoc', 'seno', 'strav', 'traven', 'voda', 'vyziv', 'zelenin',
  ],
  health: [
    'bolest', 'chorob', 'hnačk', 'liec', 'naduv', 'ockov', 'parazit', 'veterin', 'zdrav', 'zub',
  ],
  care: [
    'byvan', 'hygien', 'kliet', 'podstiel', 'priestor', 'starostliv', 'toalet',
  ],
  bonding: [
    'zoznam', 'spoluzit', 'partner', 'skupin', 'social',
  ],
};

export const normalizeArticleText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

export const normalizeCategoryKey = (value) => normalizeArticleText(value)
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64);

const stemToken = (token) => {
  for (const suffix of STEM_SUFFIXES) {
    if (token.length - suffix.length >= 4 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
};

const extractKeywords = (value) => new Set(
  normalizeArticleText(value)
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    .map(stemToken)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
);

const getTopicKeys = (value) => {
  const normalized = normalizeArticleText(value);
  return Object.entries(TOPIC_GROUPS)
    .filter(([, signals]) => signals.some((signal) => normalized.includes(signal)))
    .map(([topic]) => topic);
};

const countOverlap = (left, right) => {
  let count = 0;
  left.forEach((token) => {
    if (right.has(token)) count += 1;
  });
  return count;
};

const sanitizeProfile = (value) => {
  const categories = {};
  const rawCategories = value?.categories;
  if (rawCategories && typeof rawCategories === 'object' && !Array.isArray(rawCategories)) {
    Object.entries(rawCategories).slice(0, 24).forEach(([category, score]) => {
      const key = normalizeCategoryKey(category);
      const numericScore = Math.min(MAX_CATEGORY_SCORE, Math.max(0, Math.floor(Number(score) || 0)));
      if (key && numericScore) categories[key] = numericScore;
    });
  }

  const recentlyViewedArticles = Array.isArray(value?.recentlyViewedArticles)
    ? [...new Set(value.recentlyViewedArticles
      .map((slug) => String(slug || '').trim().slice(0, 191))
      .filter(Boolean))].slice(0, MAX_RECENT_ARTICLES)
    : [];

  return { categories, recentlyViewedArticles };
};

export const loadArticleInterestProfile = () => {
  if (typeof window === 'undefined') return EMPTY_PROFILE;

  try {
    const stored = window.localStorage.getItem(ARTICLE_INTERESTS_STORAGE_KEY);
    return stored ? sanitizeProfile(JSON.parse(stored)) : EMPTY_PROFILE;
  } catch {
    return EMPTY_PROFILE;
  }
};

const storeArticleInterestProfile = (profile) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(ARTICLE_INTERESTS_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Recommendations still work from the current article if storage is unavailable.
  }

  window.dispatchEvent(new CustomEvent(ARTICLE_INTERESTS_CHANGED_EVENT, { detail: profile }));
};

export const recordArticleView = (article, viewKey = '') => {
  const slug = String(article?.slug || '').trim().slice(0, 191);
  if (!slug) return loadArticleInterestProfile();

  const dedupeKey = `${slug}:${String(viewKey || 'view')}`;
  if (recordedViewKeys.has(dedupeKey)) return loadArticleInterestProfile();
  recordedViewKeys.add(dedupeKey);

  const current = loadArticleInterestProfile();
  const categoryKey = normalizeCategoryKey(article?.category);
  const categories = { ...current.categories };
  if (categoryKey) {
    categories[categoryKey] = Math.min(MAX_CATEGORY_SCORE, (categories[categoryKey] || 0) + 1);
  }

  const recentlyViewedArticles = [
    slug,
    ...current.recentlyViewedArticles.filter((recentSlug) => recentSlug !== slug),
  ].slice(0, MAX_RECENT_ARTICLES);

  const next = { categories, recentlyViewedArticles };
  storeArticleInterestProfile(next);
  return next;
};

export const rankRecommendedArticles = ({
  articles = [],
  currentArticle,
  interestProfile = EMPTY_PROFILE,
  limit = 4,
}) => {
  const currentSlug = String(currentArticle?.slug || '');
  const currentId = currentArticle?.id == null ? null : String(currentArticle.id);
  const currentCategory = normalizeCategoryKey(currentArticle?.category);
  const currentPriorityText = `${currentArticle?.title || ''} ${currentArticle?.excerpt || ''}`;
  const currentContextText = `${currentPriorityText} ${String(currentArticle?.content || '').slice(0, 12000)}`;
  const currentPriorityKeywords = extractKeywords(currentPriorityText);
  const currentContextKeywords = extractKeywords(currentContextText);
  const currentTopics = new Set(getTopicKeys(currentContextText));
  const recentSlugs = new Set(sanitizeProfile(interestProfile).recentlyViewedArticles.slice(0, 8));
  const categoryInterests = sanitizeProfile(interestProfile).categories;

  return articles
    .filter((article) => {
      if (!article?.slug || article.slug === currentSlug) return false;
      return currentId === null || String(article.id) !== currentId;
    })
    .map((article, index) => {
      const candidatePriorityText = `${article.title || ''} ${article.excerpt || ''}`;
      const candidateTitleKeywords = extractKeywords(article.title || '');
      const candidateKeywords = extractKeywords(candidatePriorityText);
      const titleOverlap = countOverlap(currentPriorityKeywords, candidateTitleKeywords);
      const priorityOverlap = countOverlap(currentPriorityKeywords, candidateKeywords);
      const contextOverlap = countOverlap(currentContextKeywords, candidateKeywords);
      const sharedTopics = getTopicKeys(candidatePriorityText)
        .filter((topic) => currentTopics.has(topic)).length;
      const categoryKey = normalizeCategoryKey(article.category);
      const sameCategory = Boolean(currentCategory && categoryKey === currentCategory);
      const hasDirectRelationship = titleOverlap > 0 || priorityOverlap > 0 || contextOverlap > 0;

      let score = 0;
      if (hasDirectRelationship) {
        score += 320 + (titleOverlap * 70) + (priorityOverlap * 38) + (contextOverlap * 12);
      }
      if (sameCategory) score += 180;
      score += sharedTopics * 90;
      score += Math.min(10, categoryInterests[categoryKey] || 0) * 6;
      score += Math.max(0, 28 - index);
      if (recentSlugs.has(article.slug)) score -= 220;

      return { article, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, limit))
    .map(({ article }) => article);
};

export const clearArticleInterestProfile = () => {
  recordedViewKeys.clear();
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ARTICLE_INTERESTS_STORAGE_KEY);
  } catch {
    // Ignore storage failures in this reset helper.
  }
};
