import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { loadPostSummaries } from '../api/client';
import { getCategoryConfig } from '../constants/categories';
import { rankRecommendedArticles } from '../utils/articleRecommendations';

const RecommendationSkeleton = () => (
  <div className="article-recommendations__grid" aria-hidden="true">
    {[0, 1, 2, 3].map((index) => (
      <div className="article-recommendation-card article-recommendation-card--skeleton" key={index}>
        <span className="article-recommendation-card__media" />
        <span className="article-recommendation-card__skeleton-copy">
          <span />
          <span />
          <span />
        </span>
      </div>
    ))}
  </div>
);

const RecommendationCard = ({ article, from }) => {
  const categoryConfig = getCategoryConfig(article.category);
  const CategoryIcon = categoryConfig.icon;

  return (
    <article className="article-recommendation-card">
      <Link to={`/post/${article.slug}`} state={{ from }}>
        <div className="article-recommendation-card__media">
          {article.image ? (
            <img
              src={article.image}
              alt=""
              width="640"
              height="400"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="article-recommendation-card__placeholder" aria-hidden="true">
              <BookOpen size={30} strokeWidth={1.7} />
            </span>
          )}
        </div>
        <div className="article-recommendation-card__body">
          <span
            className="article-recommendation-card__category"
            style={{ color: categoryConfig.color }}
          >
            {CategoryIcon ? <CategoryIcon size={15} strokeWidth={2.2} aria-hidden="true" /> : null}
            {article.category || 'Článok'}
          </span>
          <h3>{article.title}</h3>
          {article.excerpt ? <p>{article.excerpt}</p> : null}
          <span className="article-recommendation-card__link-label">
            Prečítať článok
            <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
          </span>
        </div>
      </Link>
    </article>
  );
};

const RecommendedArticles = ({ currentArticle, interestProfile }) => {
  const [articles, setArticles] = useState([]);
  const [loadState, setLoadState] = useState('loading');

  useEffect(() => {
    let cancelled = false;

    loadPostSummaries()
      .then((nextArticles) => {
        if (cancelled) return;
        setArticles(nextArticles);
        setLoadState('loaded');
      })
      .catch(() => {
        if (cancelled) return;
        setArticles([]);
        setLoadState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [currentArticle.slug]);

  const recommendations = useMemo(() => rankRecommendedArticles({
    articles,
    currentArticle,
    interestProfile,
    limit: 4,
  }), [articles, currentArticle, interestProfile]);

  const from = `/post/${currentArticle.slug}`;

  return (
    <section className="article-recommendations" aria-labelledby="article-recommendations-heading">
      <div className="article-recommendations__heading-row">
        <div>
          <span className="article-recommendations__eyebrow">Vybrané pre teba</span>
          <h2 id="article-recommendations-heading">Čítaj ďalej</h2>
        </div>
        {loadState === 'loaded' && recommendations.length > 0 ? (
          <Link className="article-recommendations__all-link" to="/">
            Všetky články
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      {loadState === 'loading' ? (
        <>
          <span className="sr-only" role="status">Načítavam odporúčané články…</span>
          <RecommendationSkeleton />
        </>
      ) : null}

      {loadState === 'loaded' && recommendations.length > 0 ? (
        <div className="article-recommendations__grid">
          {recommendations.map((article) => (
            <RecommendationCard article={article} from={from} key={article.id || article.slug} />
          ))}
        </div>
      ) : null}

      {loadState !== 'loading' && recommendations.length === 0 ? (
        <div className="article-recommendations__empty">
          <p>Ďalšie užitočné články nájdeš na hlavnej stránke Zajkológie.</p>
          <Link to="/">
            Pozrieť všetky články
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </section>
  );
};

export default RecommendedArticles;
