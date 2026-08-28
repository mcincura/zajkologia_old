import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, Crown, FileText, Headphones, Play } from 'lucide-react';
import SearchBar from '../components/SearchBar';
import PostCard from '../components/PostCard';
import ProductCard from '../components/ProductCard';
import EmailCaptureOffer from '../components/EmailCaptureOffer';
import { apiFetch, mapPostFromApi } from '../api/client';
import { getCategoryConfig } from '../constants/categories';
import { useProducts } from '../hooks/useProducts';
import '../styles/home.css';
import '../styles/products.css';

const PRODUCTS_CATEGORY_NAME = 'Produkty';
const PRODUCTS_CARD_ACCENT = '#F8E8D4';
const CLUB_FEATURES = [
  { label: 'Edukačné materiály', icon: <FileText aria-hidden="true" size={22} strokeWidth={1.8} /> },
  { label: 'Videá', icon: <Play aria-hidden="true" size={22} strokeWidth={1.8} /> },
  { label: 'Príručky', icon: <BookOpen aria-hidden="true" size={22} strokeWidth={1.8} /> },
  { label: 'Audioblogy', icon: <Headphones aria-hidden="true" size={22} strokeWidth={1.8} /> },
];
const CATEGORY_TILE_SIZE = '124px';
const CATEGORY_TILE_HEIGHT = '94px';
const CATEGORY_TILE_BASE_STYLE = {
  width: CATEGORY_TILE_SIZE,
  height: CATEGORY_TILE_HEIGHT,
  flex: `0 0 ${CATEGORY_TILE_SIZE}`,
  padding: '0.9rem 0.7rem',
  borderRadius: '16px',
  fontWeight: '700',
  transition: 'all 0.2s',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.65rem',
  textAlign: 'center',
};

const Home = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [posts, setPosts] = useState([]);
  const [categories, setCategories] = useState([]);
  const { products, loading: productsLoading } = useProducts();

  useEffect(() => {
    const cat = searchParams.get('category') || null;
    setSelectedCategory((prev) => (prev === cat ? prev : cat));
  }, [searchParams]);

  const setCategory = (cat) => {
    setSelectedCategory(cat);
    const next = new URLSearchParams(searchParams);
    if (cat) next.set('category', cat);
    else next.delete('category');
    setSearchParams(next);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [catsRes, postsRes] = await Promise.all([
          apiFetch('/api/categories'),
          apiFetch('/api/posts'),
        ]);
        if (cancelled) return;
        setCategories(catsRes?.categories || []);
        setPosts((postsRes?.posts || []).map(mapPostFromApi));
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'Failed to load posts');
        setCategories([]);
        setPosts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredPosts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return posts.filter((post) => {
      const title = (post.title || '').toLowerCase();
      const excerpt = (post.excerpt || '').toLowerCase();
      const matchesSearch = !term || title.includes(term) || excerpt.includes(term);
      const matchesCategory = selectedCategory
        ? post.category === selectedCategory
        : true;
      return matchesSearch && matchesCategory;
    });
  }, [posts, searchTerm, selectedCategory]);

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return products.filter((product) => {
      const title = (product.name || '').toLowerCase();
      const excerpt = (product.shortDescription || product.description || '').toLowerCase();
      return !term || title.includes(term) || excerpt.includes(term);
    });
  }, [products, searchTerm]);

  return (
    <>
      {/* Hero Section */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "5rem 0",
          marginBottom: "3rem",
          textAlign: "center",
          color: "white"
        }}
      >
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: "linear-gradient(to right, rgba(138, 28, 43, 0.2), rgba(202, 139, 97, 0.1)), url('https://i.ibb.co/jPTpVxs0/IMG-9423.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(3px)",
          transform: "scale(1.1)", // Prevent white edges from blur
          zIndex: 0
        }} />
        <div
          className="container"
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1.5rem",
          }}
        >
          <h1 style={{ fontSize: "3.5rem", color: "white", margin: 0, fontWeight: '800', textShadow: '2px 2px 10px rgba(0,0,0,0.5)' }}>
            Vitajte na Zajkológii
          </h1>
          <p
            style={{
              fontSize: "1.25rem",
              maxWidth: "600px",
              margin: "0 auto",
              color: "rgba(255, 255, 255, 0.9)",
            }}
          >
            Spájame lásku ku králikom s poznaním.
          </p>
          <SearchBar onSearch={setSearchTerm} />
          <div className="home-hero-actions">
            <section className="home-hero-club-card" aria-labelledby="home-club-title">
              <div className="home-hero-club-card__intro">
                <span className="home-hero-club-card__crown" aria-hidden="true">
                  <Crown size={34} strokeWidth={1.8} />
                </span>
                <div className="home-hero-club-card__copy">
                  <h2 id="home-club-title">Zajkológia Klub</h2>
                  <p>Exkluzívny obsah pre majiteľov, ktorí chcú ísť viac do hĺbky.</p>
                </div>
              </div>

              <img
                className="home-hero-club-card__rabbit"
                src="/club-rabbit-book.png"
                width="720"
                height="763"
                alt=""
                aria-hidden="true"
              />

              <p className="home-hero-club-card__offer">
                <strong>1 + 1 mesiac v Klube</strong>
                <span>Zaplatíte prvý mesiac a druhý získate zadarmo.</span>
              </p>

              <ul className="home-hero-club-card__features" aria-label="Obsah v Zajkológia Klube">
                {CLUB_FEATURES.map(({ label, icon }) => (
                  <li key={label}>
                    {icon}
                    <span>{label}</span>
                  </li>
                ))}
              </ul>

              <Link className="home-hero-club-card__button" to="/klub">
                Vstúpiť do Zajkológia klubu
                <ArrowRight aria-hidden="true" size={20} strokeWidth={2.4} />
              </Link>
            </section>

            <div className="home-newsletter-slot">
              <EmailCaptureOffer placement="home" />
            </div>

            <Link className="home-hero-about-link" to="/o-nas">
              Zistiť viac o Zajkológii
              <ArrowRight aria-hidden="true" size={16} strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </section>

      <div className="container">
        <div className="home-intro-stack">
          {/* Categories */}
          <div className="home-categories-slot">
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "1rem",
                flexWrap: "wrap",
              }}
            >
              {categories.map((cat) => {
                const config = getCategoryConfig(cat.name);
                const Icon = config.icon;
                const isSelected = selectedCategory === cat.name;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setCategory(isSelected ? null : cat.name)}
                    style={{
                      ...CATEGORY_TILE_BASE_STYLE,
                      backgroundColor: isSelected ? config.color : config.bg,
                      color: isSelected ? 'var(--color-background)' : config.color,
                      border: isSelected ? `2px solid ${config.color}` : `2px solid transparent`,
                      boxShadow: isSelected ? `0 4px 12px ${config.color}44` : '0 2px 4px rgba(0,0,0,0.05)'
                    }}
                  >
                    {Icon && <Icon size={28} strokeWidth={2} />}
                    <span style={{ lineHeight: 1.15 }}>{cat.name}</span>
                  </button>
                );
              })}
              {(() => {
                const config = getCategoryConfig(PRODUCTS_CATEGORY_NAME);
                const Icon = config.icon;
                const isSelected = selectedCategory === PRODUCTS_CATEGORY_NAME;
                return (
                  <button
                    onClick={() => setCategory(isSelected ? null : PRODUCTS_CATEGORY_NAME)}
                    aria-pressed={isSelected}
                    style={{
                      ...CATEGORY_TILE_BASE_STYLE,
                      backgroundColor: isSelected ? config.color : config.bg,
                      color: isSelected ? 'var(--color-background)' : config.color,
                      border: isSelected ? `2px solid ${config.color}` : `2px solid transparent`,
                      boxShadow: isSelected ? `0 4px 12px ${config.color}44` : '0 2px 4px rgba(0,0,0,0.05)'
                    }}
                  >
                    {Icon && <Icon size={28} strokeWidth={2} />}
                    <span style={{ lineHeight: 1.15 }}>{PRODUCTS_CATEGORY_NAME}</span>
                  </button>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Posts Display */}
        <div style={{ marginBottom: "4rem" }}>
          {(!selectedCategory && !searchTerm) ? (
            <>
              {categories.map(cat => {
                const catPosts = posts.filter(p => p.category === cat.name).slice(0, 3);
                if (catPosts.length === 0) return null;
                const config = getCategoryConfig(cat.name);
                const Icon = config.icon;
                return (
                  <div key={cat.id} style={{ marginBottom: '5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                      <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: config.color, margin: 0 }}>
                        {Icon && <span style={{ display: 'inline-flex', padding: '0.5rem', backgroundColor: config.bg, borderRadius: '12px' }}><Icon size={24} /></span>}
                        {cat.name}
                      </h2>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "2rem", marginBottom: "2rem" }}>
                      {catPosts.map(post => <PostCard key={post.id} post={post} />)}
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <button onClick={() => setCategory(cat.name)} style={{ padding: '0.8rem 2.5rem', borderRadius: '50px', backgroundColor: config.bg, color: config.color, fontWeight: '700', border: 'none', fontSize: '1rem', cursor: 'pointer', transition: 'transform 0.2s' }} onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'} onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                        Zobraziť viac z kategórie {cat.name}
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredProducts.length > 0 && (
                <div id="produkty" style={{ marginBottom: '5rem', scrollMarginTop: '90px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.5rem' }}>
                    <h2 style={{ margin: 0 }}>Produkty</h2>
                    <Link to="/?category=Produkty" style={{ color: '#7a3f00', fontWeight: 800 }}>
                      Zobraziť všetky produkty
                    </Link>
                  </div>
                  <div className="products-grid">
                    {filteredProducts.slice(0, 3).map(product => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        accentColor={PRODUCTS_CARD_ACCENT}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : selectedCategory === PRODUCTS_CATEGORY_NAME ? (
            <>
              {productsLoading ? (
                <div className="products-empty">
                  <h3>Načítavam produkty…</h3>
                </div>
              ) : filteredProducts.length > 0 ? (
                <div id="produkty" style={{ scrollMarginTop: '90px' }}>
                  <div className="products-grid products-grid--catalog">
                    {filteredProducts.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        accentColor={PRODUCTS_CARD_ACCENT}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="products-empty">
                  <h3>Momentálne nemáme žiadne produkty</h3>
                </div>
              )}
            </>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                gap: "2rem"
              }}
            >
              {loading ? (
                <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "3rem" }}>
                  <h3>Načítavam…</h3>
                </div>
              ) : error ? (
                <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "3rem" }}>
                  <h3>Nepodarilo sa načítať články</h3>
                  <div style={{ color: "#666", marginTop: "0.5rem" }}>{error}</div>
                </div>
              ) : filteredPosts.length > 0 ? (
                filteredPosts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))
              ) : (
                <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "3rem" }}>
                  <h3>Žiadne články nespĺňajú vaše kritériá vyhľadávania</h3>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Home;
