import { beforeEach, describe, expect, it } from 'vitest';
import {
  ARTICLE_INTERESTS_STORAGE_KEY,
  clearArticleInterestProfile,
  loadArticleInterestProfile,
  rankRecommendedArticles,
  recordArticleView,
} from './articleRecommendations';

const currentArticle = {
  id: 1,
  slug: 'preco-kralik-dupe',
  title: 'Prečo králik dupe?',
  excerpt: 'Dupanie je súčasťou reči tela a komunikácie králika.',
  content: 'Králik môže dupať pri strachu, strese alebo frustrácii. Nie je to dominancia.',
  category: 'Správanie',
};

const candidates = [
  {
    id: 2,
    slug: 'rec-tela-kralika',
    title: 'Reč tela králika: ako jej rozumieť',
    excerpt: 'Komunikácia, strach a signály, ktorými králik vyjadruje nepohodu.',
    category: 'Správanie',
  },
  {
    id: 3,
    slug: 'agresivita-u-kralika',
    title: 'Agresivita a teritoriálne správanie',
    excerpt: 'Ako rozpoznať frustráciu a stres.',
    category: 'Správanie',
  },
  {
    id: 4,
    slug: 'seno-pre-kralika',
    title: 'Ako vybrať kvalitné seno',
    excerpt: 'Praktické tipy pre zdravú stravu.',
    category: 'Strava',
  },
  {
    id: 5,
    slug: 'preventivna-prehliadka',
    title: 'Preventívna veterinárna prehliadka',
    excerpt: 'Čo sledovať pri kontrole zdravia.',
    category: 'Zdravie',
  },
];

beforeEach(() => {
  clearArticleInterestProfile();
});

describe('article interest tracking', () => {
  it('stores bounded first-party category counts and recent slugs without personal data', () => {
    recordArticleView({ slug: 'strava-1', category: 'Strava' }, 'view-1');
    recordArticleView({ slug: 'strava-2', category: 'Strava' }, 'view-2');
    recordArticleView({ slug: 'zdravie-1', category: 'Zdravie' }, 'view-3');

    const profile = loadArticleInterestProfile();
    expect(profile.categories).toEqual({ strava: 2, zdravie: 1 });
    expect(profile.recentlyViewedArticles).toEqual(['zdravie-1', 'strava-2', 'strava-1']);
    expect(JSON.parse(window.localStorage.getItem(ARTICLE_INTERESTS_STORAGE_KEY)))
      .not.toHaveProperty('email');
  });

  it('deduplicates the same rendered page view', () => {
    recordArticleView({ slug: 'strava-1', category: 'Strava' }, 'same-view');
    recordArticleView({ slug: 'strava-1', category: 'Strava' }, 'same-view');

    expect(loadArticleInterestProfile().categories.strava).toBe(1);
  });
});

describe('recommendation ranking', () => {
  it('prioritizes direct topic relevance and never returns the current article', () => {
    const ranked = rankRecommendedArticles({
      articles: [currentArticle, ...candidates],
      currentArticle,
      limit: 4,
    });

    expect(ranked[0].slug).toBe('rec-tela-kralika');
    expect(ranked.map((article) => article.slug)).not.toContain(currentArticle.slug);
  });

  it('uses repeated category interest and demotes just-read articles when alternatives exist', () => {
    const interestProfile = {
      categories: { strava: 6 },
      recentlyViewedArticles: ['preventivna-prehliadka'],
    };
    const neutralCurrent = {
      id: 99,
      slug: 'novinky',
      title: 'Novinky zo Zajkológie',
      excerpt: 'Prehľad nových tém.',
      content: '',
      category: 'Zaujímavosti',
    };

    const ranked = rankRecommendedArticles({
      articles: [candidates[3], candidates[2], candidates[1]],
      currentArticle: neutralCurrent,
      interestProfile,
      limit: 3,
    });

    expect(ranked[0].slug).toBe('seno-pre-kralika');
    expect(ranked.at(-1).slug).toBe('preventivna-prehliadka');
  });
});
