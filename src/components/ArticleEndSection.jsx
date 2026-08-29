import { useEffect, useState } from 'react';
import NewsletterArticleCTA from './NewsletterArticleCTA';
import RecommendedArticles from './RecommendedArticles';
import { recordArticleView } from '../utils/articleRecommendations';
import {
  NEWSLETTER_SUBSCRIBER_CHANGED_EVENT,
  NEWSLETTER_SUBSCRIBER_STORAGE_KEY,
  isNewsletterSubscriberRecognized,
} from '../utils/newsletterSubscriber';
import '../styles/article-end.css';

const ArticleEndSection = ({ article, viewKey }) => {
  const [isSubscriber, setIsSubscriber] = useState(isNewsletterSubscriberRecognized);
  const [interestProfile] = useState(() => recordArticleView(article, viewKey));

  useEffect(() => {
    const syncSubscriberState = () => {
      setIsSubscriber(isNewsletterSubscriberRecognized());
    };
    const syncSubscriberStorage = (event) => {
      if (!event.key || event.key === NEWSLETTER_SUBSCRIBER_STORAGE_KEY) {
        syncSubscriberState();
      }
    };

    window.addEventListener(NEWSLETTER_SUBSCRIBER_CHANGED_EVENT, syncSubscriberState);
    window.addEventListener('storage', syncSubscriberStorage);
    return () => {
      window.removeEventListener(NEWSLETTER_SUBSCRIBER_CHANGED_EVENT, syncSubscriberState);
      window.removeEventListener('storage', syncSubscriberStorage);
    };
  }, []);

  return (
    <aside className="article-end" aria-label="Pokračovanie po článku">
      {isSubscriber ? (
        <RecommendedArticles
          currentArticle={article}
          interestProfile={interestProfile}
          key={article.slug}
        />
      ) : (
        <NewsletterArticleCTA onSubscribed={() => setIsSubscriber(true)} />
      )}
    </aside>
  );
};

export default ArticleEndSection;
