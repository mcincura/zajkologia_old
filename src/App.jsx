import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import PostDetails from './pages/PostDetails';
import ProductDetails from './pages/ProductDetails';
import CheckoutSuccess from './pages/CheckoutSuccess';
import DigitalDownloads from './pages/DigitalDownloads';
import CartPage from './pages/CartPage';
import Terms from './pages/Terms';
import About from './pages/About';
import WithdrawalRequest from './pages/WithdrawalRequest';
import ProductPreviewPage from './pages/admin/ProductPreviewPage';
import { CartProvider } from './cart/CartContext';

const Admin = lazy(() => import('./pages/Admin'));
const Membership = lazy(() => import('./pages/Membership'));
const MembershipPost = lazy(() => import('./pages/MembershipPost'));
const Discussion = lazy(() => import('./pages/Discussion'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));

const restoreStaticHostPath = () => {
  if (typeof window === 'undefined') return;

  const currentUrl = new URL(window.location.href);
  const redirectedPath = currentUrl.searchParams.get('p');
  if (!redirectedPath) return;

  currentUrl.searchParams.delete('p');
  const normalizedPath = `/${redirectedPath.replace(/^\/+/, '')}`;
  const targetUrl = new URL(normalizedPath, window.location.origin);

  currentUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  window.history.replaceState(null, '', `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
};

restoreStaticHostPath();

function App() {
  return (
    <CartProvider>
      <BrowserRouter basename=''>
        <Suspense fallback={<div className="container" style={{ padding: '4rem 1rem' }}>Načítavam…</div>}>
          <Routes>
            <Route path="/admin/products/preview" element={<ProductPreviewPage />} />
            <Route path="/" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="categories" element={<div className="container">Categories Page (Placeholder)</div>} />
              <Route path="post/:slug" element={<PostDetails />} />
              <Route path="product/:slug" element={<ProductDetails />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="checkout/:attemptId" element={<CheckoutPage />} />
              <Route path="checkout/return" element={<CheckoutPage />} />
              <Route path="checkout/success" element={<CheckoutSuccess />} />
              <Route path="downloads/:token" element={<DigitalDownloads />} />
              <Route path="klub" element={<Membership />} />
              <Route path="klub/prihlasenie" element={<Membership loginOnly />} />
              <Route path="klub/diskusia" element={<Discussion />} />
              <Route path="klub/diskusia/:threadId" element={<Discussion />} />
              <Route path="klub/:slug" element={<MembershipPost />} />
              <Route path="o-nas" element={<About />} />
              <Route path="obchodne-podmienky" element={<Terms />} />
              <Route path="odstupenie-od-zmluvy" element={<WithdrawalRequest />} />
              <Route path="admin" element={<Navigate to="/admin/orders" replace />} />
              <Route path="admin/orders" element={<Admin section="orders" />} />
              <Route path="admin/coupons" element={<Admin section="coupons" />} />
              <Route path="admin/marketing" element={<Admin section="marketing" />} />
              <Route path="admin/products" element={<Admin section="products" />} />
              <Route path="admin/posts" element={<Admin section="posts" />} />
              <Route path="admin/membership" element={<Admin section="membership" />} />
              <Route path="*" element={<div className="container">404 Not Found</div>} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </CartProvider>
  );
}

export default App;
