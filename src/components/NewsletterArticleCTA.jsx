import EmailCaptureOffer from './EmailCaptureOffer';

const NewsletterArticleCTA = ({ onSubscribed }) => (
  <EmailCaptureOffer placement="article" onSubscribed={onSubscribed} />
);

export default NewsletterArticleCTA;
