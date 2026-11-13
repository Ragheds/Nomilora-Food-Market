import { readStored, normalizeCart } from './lib/storage';
import { type ReactNode, createContext, useContext, useMemo, useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { useGetLaunchReadiness, useGetMeal, useGetRecommendations, useListMeals, useSimulateDemoCheckout } from '@workspace/api-client-react';
import type { DemoCheckoutSimulation, LaunchReadiness, Meal, RecommendationInput, RecommendationResponse } from '@workspace/api-client-react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, ClipboardList, Heart, House, Info, Leaf, Minus, Plus, Search, ShieldAlert, ShoppingBag, Sparkles, Trash2, Utensils, X } from 'lucide-react';
import { getGetMealQueryKey } from '@workspace/api-client-react';

const queryClient = new QueryClient();
const CART_KEY = 'nomilora-cart-v1';
const FAVORITES_KEY = 'nomilora-favorites-v1';
const PROFILE_KEY = 'nomilora-preferences-v1';
const HISTORY_KEY = 'nomilora-demo-history-v1';

function writeStored(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
}
function money(cents: number) { return `$${(cents / 100).toFixed(2)}`; }

type AppState = {
  meals: Meal[];
  readiness?: LaunchReadiness;
  loading: boolean;
  error: boolean;
  cart: Record<string, number>;
  setCart: (next: Record<string, number>) => void;
  favorites: string[];
  toggleFavorite: (id: string) => void;
  profile: RecommendationInput;
  setProfile: (next: RecommendationInput) => void;
  history: DemoCheckoutSimulation[];
  saveHistory: (item: DemoCheckoutSimulation) => void;
};
const AppContext = createContext<AppState | null>(null);
function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('Nomilora app context is missing');
  return ctx;
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [location]);
  const mealQuery = useListMeals();
  const launchQuery = useGetLaunchReadiness();
  const [cart, setCartState] = useState<Record<string, number>>(() => readStored(CART_KEY, {}));
  const [favorites, setFavorites] = useState<string[]>(() => readStored(FAVORITES_KEY, []));
  const [profile, setProfileState] = useState<RecommendationInput>(() => readStored(PROFILE_KEY, {
    eatingStyles: [], goals: [], cuisines: [], strictAllergens: [], dislikes: [], mealsPerWeek: 'One-time',
  }));
  const [history, setHistory] = useState<DemoCheckoutSimulation[]>(() => readStored(HISTORY_KEY, []));
  const setCart = (next: Record<string, number>) => { const safe = normalizeCart(next); setCartState(safe); writeStored(CART_KEY, safe); };
  const toggleFavorite = (id: string) => setFavorites((current) => {
    const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    writeStored(FAVORITES_KEY, next);
    return next;
  });
  const setProfile = (next: RecommendationInput) => { setProfileState(next); writeStored(PROFILE_KEY, next); };
  const saveHistory = (item: DemoCheckoutSimulation) => setHistory((current) => {
    const next = [item, ...current].slice(0, 100);
    writeStored(HISTORY_KEY, next);
    return next;
  });
  const state = useMemo<AppState>(() => ({
    meals: mealQuery.data ?? [], readiness: launchQuery.data, loading: mealQuery.isLoading, error: mealQuery.isError,
    cart, setCart, favorites, toggleFavorite, profile, setProfile, history, saveHistory,
  }), [mealQuery.data, mealQuery.isLoading, mealQuery.isError, launchQuery.data, cart, favorites, profile, history]);
  return (
    <AppContext.Provider value={state}>
      <div className="min-h-[100dvh] grain">
        <Header />
        <main key={location} className="page-enter">{children}</main>
        <Footer />
        <MobileNav />
      </div>
    </AppContext.Provider>
  );
}

function Header() {
  const { cart } = useApp();
  const count = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  return (
    <header className="sticky top-0 z-40 border-b border-[#d8d3c6] bg-[#f8f5ed]/95 backdrop-blur-md">
      <div className="mx-auto flex h-[76px] max-w-[1280px] items-center justify-between px-5 md:px-10">
        <Link href="/" className="flex items-center" aria-label="Nomilora home" data-testid="link-home-logo">
          <img src="/brand/01_nomilora_horizontal_transparent.png" alt="Nomilora" className="w-[164px] sm:w-[198px]" />
        </Link>
        <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
          <Link href="/explore" className="nav-link">Explore meals</Link>
          <Link href="/#how-it-works" className="nav-link">How it works</Link>
          <Link href="/plans" className="nav-link">Weekly plan</Link>
          <Link href="/orders" className="nav-link">Demo history</Link>
          <Link href="/profile" className="nav-link">My tastes</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/quiz" className="hidden rounded-full border border-[#d8d3c6] px-4 py-2 text-sm font-semibold text-[#163a24] hover:bg-[#eeece2] sm:inline-flex">Find my meals</Link>
          <Link href="/cart" className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[#173b27] text-[#fbf8ef] hover:bg-[#27553a]" aria-label={`Cart, ${count} items`} data-testid="link-cart-header">
            <ShoppingBag size={19} />
            {count > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#bd5d36] px-1 text-[10px] font-bold text-white">{count}</span>}
          </Link>
        </div>
      </div>
      <div className="border-t border-[#e8e3d8] bg-[#e9ecdf] px-4 py-2 text-center text-[11px] font-medium tracking-wide text-[#31513a] sm:text-xs">
        <span className="inline-flex items-center gap-2"><Info size={14} /> Preview menu · delivery and payments are not active</span>
      </div>
    </header>
  );
}
function Footer() {
  return <footer className="mt-20 border-t border-[#ddd7ca] bg-[#f0eee5] px-5 py-10 pb-24 md:pb-10">
    <div className="mx-auto flex max-w-[1180px] flex-col gap-7 md:flex-row md:items-end md:justify-between">
      <div><img src="/brand/02_nomilora_stacked_transparent.png" alt="Nomilora" className="mb-3 w-[120px]" /><p className="serif text-2xl text-[#173b27]">Good food. Your way.</p></div>
      <div className="max-w-xl text-sm leading-6 text-[#5c6759]">Nomilora is preparing to serve Queens. This is an illustrative preview only: menu details are unverified, delivery zones are not active, and checkout simulations never place or charge a real order.</div>
      <Link href="/explore" className="text-sm font-semibold text-[#a34d2c] underline underline-offset-4">Explore the menu preview</Link>
    </div>
  </footer>;
}
function MobileNav() {
  return <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[#d8d3c6] bg-[#faf8f2]/95 px-1 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur md:hidden" aria-label="Mobile navigation">
    {[
      ['/', 'Home', <House size={19} />],
      ['/explore', 'Explore', <Utensils size={19} />],
      ['/plans', 'My plan', <CalendarDays size={19} />],
      ['/orders', 'Orders', <ClipboardList size={19} />],
      ['/profile', 'Profile', <Heart size={19} />],
    ].map(([href, label, icon]) => <Link key={String(href)} href={String(href)} className="flex flex-col items-center gap-1 pb-2 text-[10px] font-semibold text-[#526253]">{icon}<span>{label}</span></Link>)}
  </nav>;
}

function StatusNotice({ readiness }: { readiness?: LaunchReadiness }) {
  return <div className="flex gap-3 rounded-xl border border-[#d8dfc9] bg-[#edf0e4] px-4 py-3 text-sm leading-5 text-[#38533d]" data-testid="status-launch-preview">
    <Info className="mt-0.5 shrink-0" size={17} />
    <p>{readiness?.notice || 'Queens delivery is planned, but delivery is not currently available. This menu is a preview.'} <span className="font-semibold">No real orders or payments.</span></p>
  </div>;
}
function SkeletonGrid() {
  return <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="overflow-hidden rounded-[20px] border border-[#e3ded2] bg-[#faf8f2]"><div className="aspect-[4/3] animate-pulse bg-[#e8e5d9]" /><div className="space-y-3 p-5"><div className="h-4 w-2/3 animate-pulse rounded bg-[#e8e5d9]" /><div className="h-3 w-full animate-pulse rounded bg-[#e8e5d9]" /><div className="h-8 w-24 animate-pulse rounded bg-[#e8e5d9]" /></div></div>)}</div>;
}
function EmptyState({ title, text, action, href }: { title: string; text: string; action?: string; href?: string }) {
  return <div className="rounded-[24px] border border-dashed border-[#cfcabb] bg-[#f1efe7] px-6 py-14 text-center">
    <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-[#e2e7d8] text-[#31513a]"><Leaf size={22} /></span>
    <h2 className="serif text-2xl text-[#173b27]">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#667064]">{text}</p>
    {action && href && <Link href={href} className="mt-5 inline-flex rounded-full bg-[#173b27] px-5 py-3 text-sm font-semibold text-[#f8f5ed]">{action}<ArrowRight size={16} className="ml-2" /></Link>}
  </div>;
}
function ErrorNotice({ retry }: { retry: () => void }) {
  return <div className="rounded-2xl border border-[#e4c7b9] bg-[#f8e9e1] p-6 text-center" role="alert"><p className="font-semibold text-[#803f2a]">We couldn't load this part of the preview.</p><p className="mt-1 text-sm text-[#73584b]">Your saved cart and preferences are still here.</p><button onClick={retry} className="mt-4 rounded-full bg-[#173b27] px-5 py-2.5 text-sm font-semibold text-white">Try again</button></div>;
}

function FoodImage({ meal, className = '' }: { meal: Meal; className?: string }) {
  return <div className={`relative overflow-hidden bg-[#e6e6d9] ${className}`}>
    <div className="absolute inset-0 z-0 flex items-center justify-center bg-[radial-gradient(ellipse_at_30%_40%,#c4c9a8_0%,#e8e5d6_70%)]"><img src="/brand/03_nomilora_symbol_transparent.png" alt="" className="w-16 opacity-20" /></div>
    {meal.photoUrl ? <img src={meal.photoUrl} alt={meal.name} className="relative z-10 h-full w-full object-cover" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : null}
    {meal.demoOnly && <span className="absolute left-3 top-3 rounded-full bg-[#f8f5ed]/95 px-3 py-1 text-[10px] font-bold uppercase tracking-[.12em] text-[#31513a]">Menu preview</span>}
  </div>;
}
function MealCard({ meal }: { meal: Meal }) {
  const { favorites, toggleFavorite, cart, setCart } = useApp();
  const favorite = favorites.includes(meal.id);
  const add = () => setCart({ ...cart, [meal.id]: (cart[meal.id] ?? 0) + 1 });
  return <article className="group overflow-hidden rounded-[20px] border border-[#e0dbcf] bg-[#fbf9f3] transition-transform duration-300 hover:-translate-y-1" data-testid={`card-meal-${meal.id}`}>
    <div className="relative">
      <Link href={`/meals/${meal.id}`} className="block"><FoodImage meal={meal} className="aspect-[4/3]" /></Link>
       {meal.featured && <span className="absolute bottom-3 left-3 rounded-full bg-[#173b27] px-3 py-1 text-[10px] font-semibold uppercase tracking-[.1em] text-[#f8f5ed]">Preview highlight</span>}
      <button onClick={() => toggleFavorite(meal.id)} aria-label={favorite ? `Remove ${meal.name} from favorites` : `Save ${meal.name} to favorites`} aria-pressed={favorite} className={`absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full shadow-sm transition-colors ${favorite ? 'bg-[#bd5d36] text-white' : 'bg-[#fbf9f3]/95 text-[#173b27] hover:bg-white'}`} data-testid={`button-favorite-${meal.id}`}><Heart size={18} fill={favorite ? 'currentColor' : 'none'} /></button>
    </div>
    <div className="p-4 sm:p-5">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#8b765f]">{meal.cuisine} · {meal.mealType}</p><Link href={`/meals/${meal.id}`} className="serif mt-1 block text-[21px] leading-tight text-[#173b27] hover:text-[#a34d2c]">{meal.name}</Link></div>
        <span className="pt-1 text-sm font-bold text-[#173b27]">{money(meal.priceCents)}</span>
      </div>
      <p className="line-clamp-2 min-h-[42px] text-sm leading-[1.5] text-[#697166]">{meal.description}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">{meal.dietaryTags.slice(0, 2).map((tag) => <span key={tag} className="rounded-full bg-[#ecefe4] px-2.5 py-1 text-[10px] font-semibold text-[#50644f]">{tag}</span>)}</div>
      <div className="mt-4 flex items-center justify-between border-t border-[#eee9dd] pt-4">
        <span className="text-[10px] font-medium text-[#8a7965]">Not orderable · details unverified</span>
        <button onClick={add} className="inline-flex items-center gap-2 rounded-full bg-[#173b27] px-4 py-2.5 text-xs font-bold text-[#fbf8ef] transition-colors hover:bg-[#2c5a3d]" data-testid={`button-add-${meal.id}`}><Plus size={15} /> Add preview</button>
      </div>
    </div>
  </article>;
}
function MealGrid({ meals }: { meals: Meal[] }) {
  const { loading, error } = useApp();
  const query = useListMeals();
  if (loading) return <SkeletonGrid />;
  if (error) return <ErrorNotice retry={() => void query.refetch()} />;
  if (!meals.length) return <EmptyState title="Nothing on this table yet" text="Try another filter or search. New dishes are being considered for the Queens preview." />;
  return <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">{meals.map((meal) => <MealCard key={meal.id} meal={meal} />)}</div>;
}

function Home() {
  const { meals, readiness } = useApp();
  const featured = meals.filter((meal) => meal.featured).slice(0, 3);
  return <div>
    <section className="mx-auto grid max-w-[1280px] items-center gap-10 px-5 pb-14 pt-10 md:grid-cols-[1.06fr_.94fr] md:px-10 md:pb-24 md:pt-16">
      <div className="max-w-[610px]">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#d4d8c7] bg-[#edf0e4] px-4 py-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#39553d]"><span className="h-2 w-2 rounded-full bg-[#bd5d36]" /> Made for the Queens table</p>
        <h1 className="serif max-w-[620px] text-[clamp(3.4rem,8vw,6.8rem)] leading-[.94] tracking-[-.045em] text-[#173b27]">Food you love. <em className="font-medium text-[#a85735]">Ready when you are.</em></h1>
        <p className="mt-6 max-w-[480px] text-base leading-7 text-[#5c6759] md:text-lg">Chef-prepared meal ideas, shaped around your taste. A Queens pilot is in the works.</p>
        <div className="mt-8 flex flex-wrap gap-3"><Link href="/explore" className="inline-flex items-center gap-3 rounded-full bg-[#173b27] px-6 py-4 text-sm font-bold text-[#faf7ed] transition hover:bg-[#2c5a3d]">Explore meals <ArrowRight size={17} /></Link><Link href="/quiz" className="rounded-full border border-[#c9c8b8] px-6 py-4 text-sm font-bold text-[#24432d] hover:bg-[#efeee6]">Find my meals</Link></div>
        <div className="mt-9 max-w-lg"><StatusNotice readiness={readiness} /></div>
      </div>
      <div className="relative mx-auto w-full max-w-[550px]">
        <div className="absolute -right-3 top-7 h-[70%] w-[78%] rounded-[46%_54%_42%_58%] bg-[#e4e8d8]" />
        <div className="relative overflow-hidden rounded-[44%_56%_46%_54%/45%_42%_58%_55%] border-[10px] border-[#f8f5ed] bg-[#dfe3d2] shadow-[0_25px_65px_rgba(37,59,40,.12)]">
          {featured[0] ? <FoodImage meal={featured[0]} className="aspect-[.92] w-full" /> : <div className="aspect-[.92] w-full bg-[radial-gradient(ellipse_at_40%_45%,#c8cda9,#e9e5d7)]" />}
        </div>
        <div className="absolute -bottom-1 left-0 max-w-[230px] rounded-2xl border border-[#e5dfd2] bg-[#fbf9f2] p-4 shadow-[0_15px_45px_rgba(40,48,34,.1)] sm:-left-7">
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#a85735]">A more personal menu</p>
          <p className="serif mt-1 text-xl text-[#173b27]">Made around your kind of good.</p>
        </div>
        <div className="absolute right-0 top-4 rounded-full bg-[#173b27] px-4 py-2 text-xs font-semibold text-[#f8f5ed]">Queens, NY · coming soon</div>
      </div>
    </section>
    <section className="border-y border-[#e1dccf] bg-[#efeee5]">
      <div className="mx-auto grid max-w-[1280px] gap-7 px-5 py-8 md:grid-cols-3 md:px-10 md:py-10">
        {[['01', 'Tell us what tastes like you', 'A quick, optional quiz gives your menu a point of view.'], ['02', 'Find a new dinner favorite', 'Browse illustrative dishes from cuisines you love.'], ['03', 'Keep it a preview for now', 'Delivery and checkout are not live. No order or payment happens.']].map(([n, title, body]) => <div key={n} className="flex gap-4"><span className="serif text-3xl text-[#a85735]">{n}</span><div><h2 className="serif text-xl text-[#173b27]">{title}</h2><p className="mt-1 text-sm leading-6 text-[#687063]">{body}</p></div></div>)}
      </div>
    </section>
    <section className="mx-auto max-w-[1280px] px-5 py-16 md:px-10 md:py-24">
      <div className="mb-8 flex items-end justify-between gap-5"><div><p className="eyebrow">A first taste</p><h2 className="serif mt-2 text-4xl text-[#173b27] md:text-5xl">On the menu preview</h2></div><Link href="/explore" className="hidden items-center gap-2 text-sm font-bold text-[#a34d2c] sm:inline-flex">See all dishes <ArrowRight size={16} /></Link></div>
      {featured.length ? <MealGrid meals={featured} /> : <MealGrid meals={meals.slice(0, 3)} />}
      <Link href="/explore" className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[#a34d2c] sm:hidden">Explore all meals <ArrowRight size={16} /></Link>
    </section>
    <section className="mx-auto max-w-[1280px] px-5 pb-10 md:px-10">
      <div className="grid overflow-hidden rounded-[28px] bg-[#173b27] md:grid-cols-[1fr_auto]">
        <div className="px-7 py-10 md:px-12 md:py-14"><p className="eyebrow !text-[#cbd5b8]">Your palate, first</p><h2 className="serif mt-3 max-w-xl text-4xl text-[#f8f5ed] md:text-5xl">A menu should start with what you love.</h2><p className="mt-4 max-w-lg leading-7 text-[#d4ddcc]">Tell us the flavors you reach for, what you avoid, and how many nights you'd like covered.</p><Link href="/quiz" className="mt-7 inline-flex items-center gap-2 rounded-full bg-[#e7e9d9] px-5 py-3 text-sm font-bold text-[#173b27]">Build my taste profile <ArrowRight size={16} /></Link></div>
        <div className="hidden w-[270px] items-center justify-center bg-[#294b34] md:flex"><img src="/brand/03_nomilora_symbol_transparent.png" alt="" className="w-40 opacity-90" /></div>
      </div>
    </section>
    <section className="mx-auto max-w-[1280px] px-5 py-14 md:px-10 md:py-20">
      <div className="mb-7"><p className="eyebrow">A table with room for everyone</p><h2 className="serif mt-2 text-4xl text-[#173b27] md:text-5xl">Find your kind of meal</h2></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {HOME_CATEGORIES.map(([title, note]) => <Link key={title} href={`/explore?category=${encodeURIComponent(title)}`} className="group rounded-[20px] border border-[#ded9cc] bg-[#fbf9f3] p-4 transition hover:-translate-y-1 hover:border-[#aab498] sm:p-5"><span className="mb-4 grid h-10 w-10 place-items-center rounded-full bg-[#e9ecdf] text-[#3f5b43]"><Utensils size={17} /></span><h3 className="serif text-lg leading-tight text-[#173b27] sm:text-xl">{title}</h3><p className="mt-2 text-xs leading-5 text-[#73786b]">{note}</p><span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-[#a34d2c]">Browse ideas <ArrowRight size={13} /></span></Link>)}
      </div>
      <p className="mt-5 text-xs leading-5 text-[#777669]">All meal labels and details are illustrative, unverified examples—not dietary or allergy certifications.</p>
    </section>
    <section id="how-it-works" className="border-y border-[#e1dccf] bg-[#efeee5]">
      <div className="mx-auto max-w-[1280px] px-5 py-14 md:px-10 md:py-20">
        <div className="max-w-2xl"><p className="eyebrow">A future pilot flow</p><h2 className="serif mt-2 text-4xl text-[#173b27] md:text-5xl">Good food, made easier.</h2><p className="mt-3 leading-7 text-[#667064]">This is how the service is intended to work once partner kitchens, delivery zones, and operating details are approved. None are active in this preview.</p></div>
        <div className="mt-9 grid gap-7 sm:grid-cols-2 lg:grid-cols-4">{[
          ['01', 'Choose your meals', 'Start with the dishes and flavors that sound good to you.'],
          ['02', 'A partner kitchen prepares them', 'Meals will be made by approved restaurant kitchens—not a Nomilora-owned kitchen.'],
          ['03', 'Pick a delivery window', 'Scheduled options will appear only when a service area is verified.'],
          ['04', 'Heat and enjoy', 'Storage and reheating guidance will be confirmed before launch.'],
        ].map(([number, title, copy]) => <article key={number} className="border-t border-[#cfcabb] pt-4"><span className="serif text-3xl text-[#a85735]">{number}</span><h3 className="serif mt-3 text-xl text-[#173b27]">{title}</h3><p className="mt-2 text-sm leading-6 text-[#687063]">{copy}</p></article>)}</div>
      </div>
    </section>
    <section className="mx-auto grid max-w-[1280px] gap-6 px-5 py-14 md:grid-cols-2 md:px-10 md:py-20">
      <article className="rounded-[24px] border border-[#ded9cc] bg-[#fbf9f3] p-6 sm:p-8"><p className="eyebrow">Order your way</p><h2 className="serif mt-2 text-3xl text-[#173b27]">A one-time meal, or a week of ideas.</h2><p className="mt-3 text-sm leading-6 text-[#667064]">Start with a one-time basket, or explore 5, 10, or 15 meal ideas for a future weekly plan. You are never enrolled by trying this preview.</p><div className="mt-5 flex flex-wrap gap-3"><Link href="/explore" className="rounded-full bg-[#173b27] px-5 py-3 text-sm font-bold text-[#fbf8ef]">Explore meals</Link><Link href="/plans" className="rounded-full border border-[#cfcabb] px-5 py-3 text-sm font-bold text-[#31513a]">Preview weekly plans</Link></div></article>
      <article className="rounded-[24px] border border-[#d9ddcb] bg-[#edf0e4] p-6 sm:p-8"><p className="eyebrow">Queens pilot</p><h2 className="serif mt-2 text-3xl text-[#173b27]">Astoria and Long Island City are planned.</h2><p className="mt-3 text-sm leading-6 text-[#667064]">No delivery zones, dates, or partner kitchens are active yet. Join the preview by exploring—this site does not collect a waitlist signup or promise delivery.</p><p className="mt-5 text-xs font-semibold text-[#69745f]">Availability status: not configured</p></article>
    </section>
    <section className="mx-auto max-w-[900px] px-5 pb-14 md:px-10 md:pb-20">
      <p className="eyebrow">Good to know</p><h2 className="serif mt-2 text-4xl text-[#173b27]">A few questions, answered.</h2>
      <div className="mt-6 divide-y divide-[#ded9cc] border-y border-[#ded9cc]">{HOME_FAQS.map(([question, answer]) => <details key={question} className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-semibold text-[#29432f]">{question}<Plus className="shrink-0 transition group-open:rotate-45" size={18} /></summary><p className="max-w-3xl pt-3 text-sm leading-6 text-[#687063]">{answer}</p></details>)}</div>
      <div className="mt-8 rounded-[22px] border border-[#ded9cc] bg-[#fbf9f3] p-6 sm:flex sm:items-center sm:justify-between sm:gap-5"><div><p className="eyebrow">Queens restaurant kitchens</p><h3 className="serif mt-2 text-2xl text-[#173b27]">Interested in a future partnership?</h3><p className="mt-2 text-sm text-[#687063]">Partner onboarding and inquiry handling are not configured yet.</p></div><span className="mt-4 inline-flex cursor-not-allowed rounded-full border border-[#d0cbbd] px-4 py-2.5 text-xs font-semibold text-[#7d7d70] sm:mt-0">Partner inquiry coming later</span></div>
    </section>
  </div>;
}

const HOME_CATEGORIES = [
  ['Everyday Favorites', 'The familiar flavors you reach for.'],
  ['High Protein', 'Protein-forward ideas, not verified nutrition.'],
  ['Plant Based', 'Plant-forward examples, not dietary certification.'],
  ['Comfort Food', 'Cozy plates and pasta favorites.'],
  ['Mediterranean', 'Bright herbs, grains, and more.'],
  ['Global Flavors', 'A little inspiration from everywhere.'],
  ['Soups & Light Meals', 'A softer start, spoon by spoon.'],
  ['Family Favorites', 'Easygoing dishes to share.'],
] as const;

const HOME_FAQS = [
  ['Where will Nomilora deliver?', 'Astoria and Long Island City are planned pilot areas only. No delivery zones or dates are active, and we cannot confirm availability yet.'],
  ['Are the dishes and prices final?', 'No. Every dish, image, price, tag, ingredient, and nutrition detail is illustrative and must be confirmed with a restaurant partner before launch.'],
  ['Can I safely use the menu with a food allergy?', 'No. All allergen declarations are unknown. Do not use this preview to make a food-safety decision; a real contact channel is not configured yet.'],
  ['Does checkout charge me or place an order?', 'No. Checkout only validates a sample basket and shows a zero-charge simulation. No food is reserved, no delivery is scheduled, and no payment is collected.'],
  ['Will a weekly plan renew automatically?', 'No plans or billing are active. The weekly plan screen is only a preview; nothing renews or enrolls you.'],
] as const;

function Explore() {
  const { meals, loading, error } = useApp();
  const query = useListMeals();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(() => new URLSearchParams(window.location.search).get('category') ?? 'All dishes');
  const [cuisine, setCuisine] = useState('All cuisines');
  const [diet, setDiet] = useState('All styles');
  const [priceCap, setPriceCap] = useState('Any price');
  const categories = ['All dishes', ...Array.from(new Set(meals.map((meal) => meal.category)))];
  const cuisines = ['All cuisines', ...Array.from(new Set(meals.map((meal) => meal.cuisine)))];
  const diets = ['All styles', ...Array.from(new Set(meals.flatMap((meal) => meal.dietaryTags)))];
  const maxPriceCents = priceCap === 'Any price' ? Number.POSITIVE_INFINITY : Number(priceCap.replace('$', '').replace(' or less', '')) * 100;
  const filtered = meals.filter((meal) => {
    const term = search.trim().toLowerCase();
    return (!term || [meal.name, meal.description, meal.cuisine, ...meal.dietaryTags].join(' ').toLowerCase().includes(term))
      && (category === 'All dishes' || meal.category === category)
      && (cuisine === 'All cuisines' || meal.cuisine === cuisine)
      && (diet === 'All styles' || meal.dietaryTags.includes(diet))
      && meal.priceCents <= maxPriceCents;
  });
  const resetFilters = () => { setSearch(''); setCategory('All dishes'); setCuisine('All cuisines'); setDiet('All styles'); setPriceCap('Any price'); };
  return <div className="mx-auto max-w-[1280px] px-5 py-10 md:px-10 md:py-16">
    <div className="mb-8 grid gap-6 md:grid-cols-[1fr_auto] md:items-end"><div><p className="eyebrow">The menu, in the making</p><h1 className="serif mt-3 text-5xl tracking-tight text-[#173b27] md:text-6xl">Explore meals</h1><p className="mt-3 max-w-xl text-[#657063]">A small preview of the dishes Nomilora is considering for Queens. Every menu detail is illustrative and unverified.</p></div><Link href="/quiz" className="inline-flex items-center gap-2 text-sm font-bold text-[#a34d2c]">Personalize your picks <ArrowRight size={16} /></Link></div>
    <div className="mb-8 rounded-2xl border border-[#d8dfc9] bg-[#edf0e4] p-4"><StatusNotice readiness={useApp().readiness} /></div>
    <div className="mb-5 grid gap-3 rounded-[20px] border border-[#dfdacd] bg-[#f7f4ec] p-3 md:grid-cols-2 xl:grid-cols-[1.4fr_repeat(4,1fr)_auto]">
      <label className="flex items-center gap-3 rounded-xl border border-[#ded9cc] bg-[#fbf9f3] px-4"><Search size={18} className="text-[#74806e]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search a dish, flavor, or cuisine" className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-[#93978a]" aria-label="Search meals" data-testid="input-search-meals" /></label>
      <select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)} className="h-12 rounded-xl border border-[#ded9cc] bg-[#fbf9f3] px-4 text-sm text-[#435543]" data-testid="select-filter-category">{categories.map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="Filter by cuisine" value={cuisine} onChange={(event) => setCuisine(event.target.value)} className="h-12 rounded-xl border border-[#ded9cc] bg-[#fbf9f3] px-4 text-sm text-[#435543]" data-testid="select-filter-cuisine">{cuisines.map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="Filter by illustrative menu style" value={diet} onChange={(event) => setDiet(event.target.value)} className="h-12 rounded-xl border border-[#ded9cc] bg-[#fbf9f3] px-4 text-sm text-[#435543]" data-testid="select-filter-diet">{diets.map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="Filter by illustrative price" value={priceCap} onChange={(event) => setPriceCap(event.target.value)} className="h-12 rounded-xl border border-[#ded9cc] bg-[#fbf9f3] px-4 text-sm text-[#435543]" data-testid="select-filter-price">{['Any price', '$15 or less', '$16 or less', '$17 or less', '$18 or less', '$19 or less'].map((value) => <option key={value}>{value}</option>)}</select>
      <button onClick={resetFilters} className="h-12 rounded-xl px-3 text-sm font-semibold text-[#a34d2c] hover:bg-[#efece3]" data-testid="button-clear-filters">Clear</button>
    </div>
    <div className="mb-4 flex items-center justify-between"><p className="text-sm text-[#6c7569]" aria-live="polite">{filtered.length} illustrative {filtered.length === 1 ? 'dish' : 'dishes'}</p><span className="inline-flex items-center gap-1 text-xs text-[#8a7b66]"><ShieldAlert size={14} /> Not allergy verified</span></div>
    {loading ? <SkeletonGrid /> : error ? <ErrorNotice retry={() => void query.refetch()} /> : <MealGrid meals={filtered} />}
  </div>;
}

function MealDetails() {
  const params = useParams<{ id: string }>();
  const { cart, setCart, favorites, toggleFavorite } = useApp();
  const id = params.id ?? '';
  const [quantity, setQuantity] = useState(1);
  const query = useGetMeal(id, { query: { enabled: !!id, queryKey: getGetMealQueryKey(id) } });
  if (query.isLoading) return <div className="mx-auto max-w-5xl px-5 py-12"><div className="grid gap-8 md:grid-cols-2"><div className="aspect-square animate-pulse rounded-3xl bg-[#e7e4d9]" /><div className="space-y-4"><div className="h-8 animate-pulse rounded bg-[#e7e4d9]" /><div className="h-24 animate-pulse rounded bg-[#e7e4d9]" /></div></div></div>;
  if (query.isError || !query.data) return <div className="mx-auto max-w-3xl px-5 py-16"><ErrorNotice retry={() => void query.refetch()} /></div>;
  const meal = query.data;
  return <div className="mx-auto max-w-[1180px] px-5 py-8 md:px-10 md:py-14">
    <Link href="/explore" className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-[#657063]"><ArrowLeft size={16} /> Back to menu</Link>
    <div className="grid gap-8 md:grid-cols-[1.05fr_.95fr] md:gap-14">
      <FoodImage meal={meal} className="aspect-[.95] max-h-[650px] rounded-[28px]" />
      <div className="py-1 md:py-5">
        <p className="eyebrow">{meal.cuisine} · {meal.mealType}</p><h1 className="serif mt-3 text-5xl leading-[1.05] text-[#173b27] md:text-6xl">{meal.name}</h1>
        <p className="mt-5 text-lg leading-8 text-[#5e695c]">{meal.description}</p>
        <div className="mt-6 flex flex-wrap gap-2">{meal.dietaryTags.map((tag) => <span key={tag} className="rounded-full bg-[#e9ecdf] px-3 py-1.5 text-xs font-semibold text-[#486047]">{tag}</span>)}</div>
        <div className="mt-8 flex items-center justify-between border-y border-[#ded9cc] py-5"><div><span className="text-xs uppercase tracking-[.14em] text-[#817662]">Illustrative price</span><p className="serif mt-1 text-3xl text-[#173b27]">{money(meal.priceCents)}</p></div><button onClick={() => toggleFavorite(meal.id)} aria-pressed={favorites.includes(meal.id)} className="flex h-11 items-center gap-2 rounded-full border border-[#cfcabb] px-4 text-sm font-semibold text-[#31513a]"><Heart size={17} fill={favorites.includes(meal.id) ? 'currentColor' : 'none'} />{favorites.includes(meal.id) ? 'Saved' : 'Save meal'}</button></div>
         <div className="mt-5 flex items-center justify-between rounded-xl border border-[#ded9cc] bg-[#fbf9f3] p-3"><span className="text-sm font-semibold text-[#405640]">Quantity</span><div className="inline-flex items-center rounded-full border border-[#dcd7cb]"><button onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity" className="grid h-10 w-10 place-items-center" data-testid="button-decrease-meal-quantity"><Minus size={15} /></button><span className="min-w-8 text-center text-sm font-semibold" aria-live="polite">{quantity}</span><button onClick={() => setQuantity((value) => Math.min(20, value + 1))} aria-label="Increase quantity" className="grid h-10 w-10 place-items-center" data-testid="button-increase-meal-quantity"><Plus size={15} /></button></div></div>
         <button onClick={() => setCart({ ...cart, [meal.id]: Math.min(20, (cart[meal.id] ?? 0) + quantity) })} className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-[#173b27] py-4 text-sm font-bold text-[#f8f5ed]" data-testid={`button-add-detail-${meal.id}`}>Add to cart <Plus size={17} /></button>
        <div className="mt-6 rounded-2xl border border-[#dfc8ba] bg-[#f8eae1] p-4 text-sm leading-6 text-[#744a38]"><div className="mb-1 flex items-center gap-2 font-bold"><ShieldAlert size={16} /> Allergy and nutrition details unverified</div>Ingredients and allergen declarations may be incomplete. Never rely on this preview to make a food-safety decision.</div>
        <div className="mt-7 space-y-4 text-sm text-[#5f6c5d]">
          <DetailLine label="Ingredients" value={meal.ingredients.join(', ') || 'Not provided'} />
          <DetailLine label="Allergens" value={meal.allergens.join(', ') || 'Declarations unknown'} />
          <DetailLine label="Nutrition" value="Not verified" />
          <DetailLine label="Portion" value={meal.portion} /><DetailLine label="Storage" value={meal.storage} /><DetailLine label="Reheating" value={meal.reheating} />
        </div>
       <p className="mt-7 text-xs leading-5 text-[#898477]">Menu details and availability have not been verified. Adding this dish only saves it to your local preview cart. Delivery is not active.</p>
      </div>
    </div>
  </div>;
}
function DetailLine({ label, value }: { label: string; value: string }) { return <div className="grid grid-cols-[100px_1fr] gap-3 border-b border-[#e9e4d9] pb-3"><span className="font-semibold text-[#34513a]">{label}</span><span>{value}</span></div>; }

function Cart() {
  const { meals, cart, setCart, readiness } = useApp();
  const [zipCode, setZipCode] = useState('');
  const [deliveryChecked, setDeliveryChecked] = useState(false);
  const rows = Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ meal: meals.find((entry) => entry.id === id), id, quantity })).filter((entry): entry is { meal: Meal; id: string; quantity: number } => !!entry.meal);
  const subtotal = rows.reduce((sum, row) => sum + row.meal.priceCents * row.quantity, 0);
  const update = (id: string, amount: number) => {
    const quantity = Math.max(0, Math.min(20, amount));
    const next = { ...cart };
    if (quantity) next[id] = quantity; else delete next[id];
    setCart(next);
  };
  return <div className="mx-auto max-w-[1100px] px-5 py-10 md:px-10 md:py-16">
    <p className="eyebrow">Your saved selection</p><h1 className="serif mt-2 text-5xl text-[#173b27]">Preview cart</h1><p className="mt-3 text-[#677165]">Nothing here is an active order. Your selection is saved on this device.</p>
    <div className="mt-7"><StatusNotice readiness={readiness} /></div>
    {!rows.length ? <div className="mt-9"><EmptyState title="Your table is still clear" text="Add a dish from the menu preview and it will be saved here." action="Browse the menu" href="/explore" /></div> : <div className="mt-9 grid items-start gap-8 md:grid-cols-[1fr_340px]">
      <div className="space-y-3">{rows.map(({ meal, id, quantity }) => <article key={id} className="flex gap-4 rounded-2xl border border-[#e1dccf] bg-[#fbf9f3] p-3 sm:gap-5 sm:p-4">
        <Link href={`/meals/${id}`} className="w-[106px] shrink-0 overflow-hidden rounded-xl sm:w-[150px]"><FoodImage meal={meal} className="aspect-square h-full" /></Link>
        <div className="flex min-w-0 flex-1 flex-col justify-between py-1"><div className="flex justify-between gap-2"><div><p className="text-[10px] uppercase tracking-[.14em] text-[#8a7965]">{meal.cuisine}</p><Link href={`/meals/${id}`} className="serif mt-1 block text-xl text-[#173b27]">{meal.name}</Link></div><button onClick={() => update(id, 0)} aria-label={`Remove ${meal.name}`} className="h-9 w-9 rounded-full text-[#8b6d5b] hover:bg-[#f5e8e0]" data-testid={`button-remove-${id}`}><Trash2 size={17} /></button></div>
          <div className="mt-4 flex items-end justify-between"><div className="inline-flex items-center rounded-full border border-[#dcd7cb]"><button onClick={() => update(id, quantity - 1)} aria-label={`Decrease ${meal.name} quantity`} className="grid h-9 w-9 place-items-center"><Minus size={15} /></button><span className="min-w-7 text-center text-sm font-semibold" aria-live="polite">{quantity}</span><button onClick={() => update(id, quantity + 1)} aria-label={`Increase ${meal.name} quantity`} className="grid h-9 w-9 place-items-center"><Plus size={15} /></button></div><span className="text-sm font-bold text-[#173b27]">{money(meal.priceCents * quantity)}</span></div>
        </div>
      </article>)}</div>
      <aside className="rounded-[22px] border border-[#ddd8cc] bg-[#f1efe7] p-5 md:sticky md:top-36"><h2 className="serif text-2xl text-[#173b27]">Preview summary</h2><div className="mt-5 flex justify-between border-b border-[#d9d4c7] pb-4 text-sm text-[#657063]"><span>Illustrative subtotal</span><span className="font-bold text-[#173b27]">{money(subtotal)}</span></div>
        <div className="mt-5 rounded-xl border border-[#ded9cc] bg-[#fbf9f3] p-4"><p className="text-sm font-semibold text-[#35513a]">Check a delivery area</p><p className="mt-1 text-xs leading-5 text-[#79796d]">This only checks preview readiness; no address is saved.</p><div className="mt-3 flex gap-2"><input value={zipCode} onChange={(event) => { setZipCode(event.target.value.replace(/\D/g, '').slice(0, 5)); setDeliveryChecked(false); }} inputMode="numeric" autoComplete="postal-code" aria-label="ZIP code" placeholder="5-digit ZIP" className="h-11 min-w-0 flex-1 rounded-lg border border-[#d7d2c5] bg-white px-3 text-sm" data-testid="input-delivery-zip" /><button onClick={() => setDeliveryChecked(true)} disabled={!/^\d{5}$/.test(zipCode)} className="rounded-lg bg-[#e9ecdf] px-3 text-xs font-bold text-[#31513a] disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-check-delivery">Check</button></div>{deliveryChecked && <p className="mt-3 text-xs leading-5 text-[#8a4d36]" role="status">{readiness?.activeDeliveryZones.length ? 'Zone status needs confirmation before ordering.' : 'No verified delivery zones are active. We cannot confirm delivery for this ZIP code.'}</p>}</div>
        <div className="mt-3 rounded-xl border border-dashed border-[#d2cdbf] p-4"><p className="text-sm font-semibold text-[#5f6658]">Discount code</p><input disabled placeholder="Promos are not configured" aria-label="Discount code placeholder" className="mt-3 h-10 w-full rounded-lg border border-[#dfdacd] bg-[#f1efe7] px-3 text-xs text-[#89887c]" /><p className="mt-2 text-[11px] text-[#858376]">No discounts are applied in this preview.</p></div>
        <div className="mt-3 rounded-xl border border-[#ded9cc] bg-[#fbf9f3] p-4"><label htmlFor="delivery-slot" className="text-sm font-semibold text-[#5f6658]">Scheduled delivery</label><select id="delivery-slot" disabled className="mt-3 h-11 w-full rounded-lg border border-[#dfdacd] bg-[#f1efe7] px-3 text-xs text-[#89887c]"><option>No delivery windows configured</option></select><p className="mt-2 text-[11px] text-[#858376]">Scheduling will appear when a verified pilot zone is active.</p></div>
        <p className="mt-4 text-xs leading-5 text-[#796f5e]">Delivery, fees, taxes, and availability are not configured. This is not a live checkout.</p><Link href="/checkout" className="mt-6 flex items-center justify-center gap-2 rounded-full bg-[#173b27] py-4 text-sm font-bold text-[#fbf8ef]">Continue to demo checkout <ArrowRight size={16} /></Link><button onClick={() => setCart({})} className="mt-3 w-full rounded-full py-3 text-sm font-semibold text-[#92503a] hover:bg-[#e9e5db]">Clear preview cart</button></aside>
    </div>}
  </div>;
}

function Checkout() {
  const { meals, cart, setCart, saveHistory, readiness } = useApp();
  const simulation = useSimulateDemoCheckout();
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState<DemoCheckoutSimulation | null>(null);
  const [notice, setNotice] = useState('');
  const lines = Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ mealId: id, quantity, meal: meals.find((meal) => meal.id === id) })).filter((line): line is { mealId: string; quantity: number; meal: Meal } => !!line.meal);
  const submit = () => {
    setNotice('');
    if (!acknowledged || !lines.length) return;
    simulation.mutate({ data: { items: lines.map(({ mealId, quantity }) => ({ mealId, quantity })), acknowledgedDemoOnly: true } }, {
      onSuccess: (response) => { setResult(response); saveHistory(response); setCart({}); },
      onError: () => setNotice('The demo could not be completed right now. Your cart remains saved. Please try again.'),
    });
  };
  const total = lines.reduce((sum, line) => sum + line.meal.priceCents * line.quantity, 0);
  return <div className="mx-auto max-w-[1050px] px-5 py-10 md:px-10 md:py-16">
    <p className="eyebrow">A no-charge interaction</p><h1 className="serif mt-2 text-5xl text-[#173b27]">Demo checkout</h1><p className="mt-3 max-w-2xl text-[#657063]">This endpoint only simulates the checkout flow. It does not place a real order, reserve food, arrange delivery, or collect payment.</p>
    <div className="mt-7"><StatusNotice readiness={readiness} /></div>
    {result ? <section className="mt-8 rounded-[26px] border border-[#cbd6bd] bg-[#edf0e4] p-6 sm:p-9" aria-live="polite" data-testid="status-checkout-complete">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[#173b27] text-white"><Check size={23} /></span><p className="eyebrow mt-5">Simulation complete · no charge</p><h2 className="serif mt-2 text-4xl text-[#173b27]">No real order was placed.</h2><p className="mt-3 max-w-xl leading-7 text-[#586853]">{result.message}</p>
      <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3"><SummaryCell label="Demo reference" value={result.demoId} /><SummaryCell label="Status" value={result.status} /><SummaryCell label="Payment" value="Not charged" /></div>
      <div className="mt-7 flex flex-wrap gap-3"><Link href="/orders" className="rounded-full bg-[#173b27] px-5 py-3 text-sm font-bold text-white">See demo history</Link><Link href="/explore" className="rounded-full border border-[#b8c2ac] px-5 py-3 text-sm font-bold text-[#31513a]">Return to the menu</Link></div>
    </section> : <div className="mt-8 grid items-start gap-8 md:grid-cols-[1fr_330px]">
      <section className="rounded-[22px] border border-[#dfdacd] bg-[#fbf9f3] p-5 sm:p-7">
        <h2 className="serif text-2xl text-[#173b27]">Your preview basket</h2>
        {lines.length ? <div className="mt-5 divide-y divide-[#ebe6db]">{lines.map((line) => <div key={line.mealId} className="flex justify-between gap-4 py-4"><div><p className="font-semibold text-[#24432d]">{line.meal.name}</p><p className="mt-1 text-xs text-[#7b7d70]">Quantity {line.quantity} · illustrative details</p></div><span className="font-semibold">{money(line.meal.priceCents * line.quantity)}</span></div>)}</div> : <div className="py-7"><EmptyState title="No dishes to simulate" text="Add an illustrative meal before trying the demo checkout." action="Explore meals" href="/explore" /></div>}
        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-[#dfdacd] bg-[#f4f2ea] p-4 text-sm leading-6 text-[#505f4e]"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1 h-4 w-4 accent-[#173b27]" data-testid="checkbox-acknowledge-demo" /><span>I understand this is a demo only. No real order, delivery, or payment will happen.</span></label>
        {notice && <p role="alert" className="mt-4 text-sm text-[#923d2d]">{notice}</p>}
      </section>
      <aside className="rounded-[22px] border border-[#dfdacd] bg-[#f1efe7] p-5"><h2 className="serif text-2xl text-[#173b27]">Zero-charge simulation</h2><div className="mt-5 flex justify-between border-b border-[#d9d4c7] pb-4 text-sm"><span>Illustrative subtotal</span><b>{money(total)}</b></div><p className="mt-4 text-xs leading-5 text-[#706f62]">All prices and menu information are unverified. Delivery zones and payments are disabled.</p><button onClick={submit} disabled={!lines.length || !acknowledged || simulation.isPending} className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[#173b27] py-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-simulate-checkout">{simulation.isPending ? 'Simulating…' : 'Run demo checkout'} <ArrowRight size={16} /></button>{simulation.isPending && <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#dfe2d3]"><div className="h-full w-2/3 animate-pulse rounded-full bg-[#9eaf85]" /></div>}</aside>
    </div>}
  </div>;
}
function SummaryCell({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-[#d8dfc9] bg-[#f6f6ed] p-3"><p className="text-[10px] uppercase tracking-[.13em] text-[#7a806e]">{label}</p><p className="mt-1 break-all font-semibold text-[#31513a]">{value}</p></div>; }

const STYLE_OPTIONS = ['Everything', 'Vegan', 'Vegetarian', 'Pescatarian', 'High Protein', 'Halal preference', 'Kosher preference', 'Low Carb', 'Keto', 'Dairy avoidance', 'Gluten avoidance', 'Soups or blended meals'];
const GOAL_OPTIONS = ['Convenience', 'Delicious everyday meals', 'Balanced meals', 'More protein', 'More vegetables', 'Discover new cuisines', 'Family meals'];
const CUISINE_OPTIONS = ['American', 'Italian', 'Mediterranean', 'Middle Eastern', 'Mexican', 'Indian', 'Japanese', 'Korean', 'Chinese-inspired', 'Other'];
const ALLERGEN_OPTIONS = ['Milk', 'Egg', 'Fish', 'Crustacean shellfish', 'Tree nuts', 'Peanuts', 'Wheat', 'Soy', 'Sesame'];
const WEEK_OPTIONS = ['One-time', '3–4', '5–7', '8–10', '10+'];
function Quiz() {
  const { profile, setProfile, meals } = useApp();
  const recommendation = useGetRecommendations();
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const toggle = (key: 'eatingStyles' | 'goals' | 'cuisines' | 'strictAllergens', value: string) => {
    const current = profile[key] as string[];
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    setProfile({ ...profile, [key]: next } as RecommendationInput);
    setResult(null);
  };
  const finish = () => recommendation.mutate({ data: profile }, { onSuccess: setResult });
  const steps = ['How you eat', 'What matters', 'Favorite cuisines', 'Things to avoid', 'Your week'];
  const recommended = profile.strictAllergens.length ? [] : result?.recommendations.map((entry) => meals.find((meal) => meal.id === entry.mealId)).filter((meal): meal is Meal => !!meal) ?? [];
  return <div className="mx-auto max-w-[960px] px-5 py-10 md:px-10 md:py-16">
    <p className="eyebrow">The Nomilora taste quiz</p><h1 className="serif mt-2 text-5xl text-[#173b27] md:text-6xl">A menu that feels like yours.</h1><p className="mt-3 max-w-xl text-[#667064]">Optional, editable, and saved only in this browser. These are preference matches, not safety or nutrition advice.</p>
    <div className="mt-8 flex gap-2" aria-label={`Step ${step + 1} of 5`}>{steps.map((label, index) => <div key={label} className={`h-1.5 flex-1 rounded-full ${index <= step ? 'bg-[#173b27]' : 'bg-[#dedbcf]'}`} />)}</div>
    <section className="mt-5 rounded-[26px] border border-[#dfdacd] bg-[#fbf9f3] p-5 sm:p-9">
      <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[.14em] text-[#a34d2c]">Step {step + 1} of 5</p><span className="text-xs text-[#878476]">{steps[step]}</span></div>
      {step === 0 && <><h2 className="serif mt-3 text-3xl text-[#173b27]">What describes how you eat?</h2><p className="mt-2 text-sm text-[#727668]">Choose any that feel right. This is not a medical filter.</p><OptionGrid options={STYLE_OPTIONS} selected={profile.eatingStyles} onToggle={(value) => toggle('eatingStyles', value)} /></>}
      {step === 1 && <><h2 className="serif mt-3 text-3xl text-[#173b27]">What would make dinner better?</h2><p className="mt-2 text-sm text-[#727668]">Pick the things you want more of.</p><OptionGrid options={GOAL_OPTIONS} selected={profile.goals} onToggle={(value) => toggle('goals', value)} /></>}
      {step === 2 && <><h2 className="serif mt-3 text-3xl text-[#173b27]">Which cuisines call to you?</h2><p className="mt-2 text-sm text-[#727668]">Select a few, or skip ahead if you're open to anything.</p><OptionGrid options={CUISINE_OPTIONS} selected={profile.cuisines} onToggle={(value) => toggle('cuisines', value)} /></>}
      {step === 3 && <><h2 className="serif mt-3 text-3xl text-[#173b27]">Anything you strictly avoid?</h2><div className="mt-4 flex gap-3 rounded-xl border border-[#e0c7b7] bg-[#faeee5] p-4 text-sm leading-6 text-[#754a39]"><ShieldAlert className="mt-1 shrink-0" size={17} /><p><b>Important:</b> all preview meal allergen declarations are unknown. If you select any strict allergen, the recommender will return no matches. Never use this preview to assess food safety.</p></div><OptionGrid options={ALLERGEN_OPTIONS} selected={profile.strictAllergens} onToggle={(value) => toggle('strictAllergens', value)} /></>}
      {step === 4 && <><h2 className="serif mt-3 text-3xl text-[#173b27]">How many dinners are you thinking?</h2><p className="mt-2 text-sm text-[#727668]">This shapes a preview only. There are no active subscriptions or plan charges.</p><div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">{WEEK_OPTIONS.map((option) => <button key={option} onClick={() => { setProfile({ ...profile, mealsPerWeek: option as RecommendationInput['mealsPerWeek'] }); setResult(null); }} aria-pressed={profile.mealsPerWeek === option} className={`rounded-2xl border px-4 py-5 text-left ${profile.mealsPerWeek === option ? 'border-[#173b27] bg-[#e8ecdf] text-[#173b27]' : 'border-[#ded9cc] bg-white/40 text-[#556252]'}`}><span className="serif text-2xl">{option}</span><span className="mt-1 block text-xs">meals each week</span></button>)}</div><label className="mt-6 block text-sm font-semibold text-[#405640]">Flavors or ingredients you dislike <input value={profile.dislikes.join(', ')} onChange={(event) => { const value = event.target.value.split(',').map((item) => item.trim()).filter(Boolean); setProfile({ ...profile, dislikes: value }); setResult(null); }} placeholder="For example: olives, cilantro" className="mt-2 h-12 w-full rounded-xl border border-[#dcd7cb] bg-[#fffdf8] px-4 font-normal outline-none focus:border-[#678265]" data-testid="input-dislikes" /><span className="mt-1 block text-xs font-normal text-[#838477]">Separate items with commas.</span></label></>}
      <div className="mt-9 flex justify-between border-t border-[#e7e2d7] pt-5"><button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} className="inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-[#5a6759] disabled:invisible"><ArrowLeft size={16} /> Back</button>{step < 4 ? <button onClick={() => setStep(step + 1)} className="inline-flex items-center gap-2 rounded-full bg-[#173b27] px-5 py-3 text-sm font-bold text-white">Continue <ArrowRight size={16} /></button> : <button onClick={finish} disabled={recommendation.isPending} className="inline-flex items-center gap-2 rounded-full bg-[#173b27] px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{recommendation.isPending ? 'Finding matches…' : 'Show my menu preview'} <Sparkles size={16} /></button>}</div>
      {recommendation.isError && <p role="alert" className="mt-4 text-sm text-[#9a432d]">We couldn't create your recommendations. Please try again.</p>}
    </section>
    {result && <section className="mt-8 rounded-[24px] border border-[#d8dfc9] bg-[#edf0e4] p-5 sm:p-8" aria-live="polite"><p className="eyebrow">Your preview</p><h2 className="serif mt-2 text-3xl text-[#173b27]">{result.preferenceSummary || 'A few ideas for your table'}</h2>{(result.allergenNotice || profile.strictAllergens.length > 0) && <div className="mt-4 flex gap-3 rounded-xl border border-[#dfc4b4] bg-[#faeee5] p-4 text-sm leading-6 text-[#754a39]"><ShieldAlert className="mt-1 shrink-0" size={18} /><p>{result.allergenNotice || 'All illustrative menu allergen declarations are unknown, so no dishes can be recommended for a strict allergen preference.'}</p></div>}{recommended.length ? <div className="mt-6"><MealGrid meals={recommended} /></div> : <div className="mt-5"><EmptyState title={profile.strictAllergens.length ? 'No safe matches in this preview' : 'No dishes match those dislikes'} text={profile.strictAllergens.length ? 'Every illustrative menu item has unknown allergen declarations. We will not recommend a dish against a strict allergen preference. The contact channel is not configured yet; do not rely on this preview for food safety.' : 'Try removing one or more dislikes, or browse the full illustrative menu.'} action="Browse menu preview" href="/explore" /></div>}</section>}
  </div>;
}
function OptionGrid({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (value: string) => void }) {
  return <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">{options.map((option) => {
    const active = selected.includes(option);
    return <button key={option} type="button" onClick={() => onToggle(option)} aria-pressed={active} className={`flex min-h-[52px] items-center justify-between rounded-xl border px-4 text-left text-sm font-semibold transition-colors ${active ? 'border-[#738b6a] bg-[#e8ecdf] text-[#24442d]' : 'border-[#e1dccf] bg-[#fffdf8] text-[#536052] hover:border-[#9eac8e]'}`}><span>{option}</span><span className={`grid h-5 w-5 place-items-center rounded-full border ${active ? 'border-[#173b27] bg-[#173b27] text-white' : 'border-[#c9c8b8]'}`}>{active && <Check size={12} />}</span></button>;
  })}</div>;
}

function Orders() {
  const { history } = useApp();
  return <div className="mx-auto max-w-[1000px] px-5 py-10 md:px-10 md:py-16"><p className="eyebrow">Saved on this device</p><h1 className="serif mt-2 text-5xl text-[#173b27]">Demo history</h1><p className="mt-3 max-w-2xl text-[#687164]">A record of checkout simulations from this browser. These are never real orders.</p>
    {history.length ? <div className="mt-8 space-y-4">{history.map((item) => <article key={item.demoId} className="rounded-[20px] border border-[#dfdacd] bg-[#fbf9f3] p-5 sm:p-7" data-testid={`card-order-${item.demoId}`}><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#a34d2c]">Simulated · not an order</p><h2 className="serif mt-1 text-2xl text-[#173b27]">Reference {item.demoId}</h2><p className="mt-1 text-xs text-[#7b7c70]">{new Date(item.createdAt).toLocaleString()}</p></div><span className="rounded-full bg-[#e9ecdf] px-3 py-1.5 text-xs font-bold text-[#38553d]">Payment not charged</span></div><div className="mt-5 divide-y divide-[#ebe6db]">{item.items.map((line) => <div key={line.mealId} className="flex justify-between py-3 text-sm"><span>{line.quantity} × {line.name}</span><span className="font-semibold">{money(line.lineTotalCents)}</span></div>)}</div><div className="mt-4 flex justify-between border-t border-[#dfdacd] pt-4 text-sm font-bold"><span>Illustrative subtotal</span><span>{money(item.subtotalCents)}</span></div><p className="mt-3 text-sm leading-6 text-[#667064]">{item.message}</p></article>)}</div> : <div className="mt-8"><EmptyState title="No simulations yet" text="Your demo history will appear here after you try a zero-charge checkout simulation." action="Explore the menu" href="/explore" /></div>}
  </div>;
}

function Plans() {
  const { meals, profile } = useApp();
  const [count, setCount] = useState(5);
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [previewAction, setPreviewAction] = useState('');
  const availableMeals = meals.filter((meal) => !profile.cuisines.length || profile.cuisines.some((cuisine) => meal.cuisine.toLowerCase().includes(String(cuisine).toLowerCase())));
  const suggestions = availableMeals.slice(0, count);
  const activeIds = selectedIds ?? suggestions.map((meal) => meal.id);
  const planMeals = activeIds.map((id) => meals.find((meal) => meal.id === id)).filter((meal): meal is Meal => !!meal);
  const togglePlanMeal = (mealId: string) => {
    const current = selectedIds ?? suggestions.map((meal) => meal.id);
    if (current.includes(mealId)) setSelectedIds(current.filter((id) => id !== mealId));
    else if (current.length < count) setSelectedIds([...current, mealId]);
  };
  return <div className="mx-auto max-w-[1120px] px-5 py-10 md:px-10 md:py-16">
    <div className="grid gap-8 md:grid-cols-[1fr_.72fr] md:items-end"><div><p className="eyebrow">A week, imagined</p><h1 className="serif mt-3 text-5xl leading-[1.02] text-[#173b27] md:text-6xl">A little less planning. A little more dinner.</h1><p className="mt-4 max-w-xl leading-7 text-[#667064]">A flexible look at what your week could feel like. This is a plan preview only—not a subscription, booking, or meal delivery.</p></div><div className="rounded-2xl border border-[#dfdacd] bg-[#f1efe7] p-5"><p className="text-xs font-bold uppercase tracking-[.14em] text-[#8b765f]">Preview size</p><select value={count} onChange={(event) => { const nextCount = Number(event.target.value); setCount(nextCount); setSelectedIds((current) => current?.slice(0, nextCount) ?? null); }} aria-label="Meals in plan preview" className="mt-3 h-12 w-full rounded-xl border border-[#d7d2c5] bg-[#fbf9f3] px-4 text-sm font-semibold text-[#31513a]">{[5, 10, 15].map((value) => <option key={value} value={value}>{value} meal ideas</option>)}</select><p className="mt-3 text-xs leading-5 text-[#77786c]">Weekly plan billing is disabled. No plan can be purchased.</p></div></div>
    <div className="mt-8 rounded-xl border border-[#d8dfc9] bg-[#edf0e4] p-4 text-sm text-[#38533d]"><Info size={16} className="mr-2 inline" />Your current taste profile influences the ideas below. All food information is illustrative and unverified.</div>
    <div className="mt-8 space-y-3">{planMeals.length ? planMeals.map((meal, index) => <article key={meal.id} className="grid items-center gap-4 rounded-[20px] border border-[#dfdacd] bg-[#fbf9f3] p-3 sm:grid-cols-[58px_96px_1fr_auto] sm:p-4"><div className="serif pl-2 text-2xl text-[#a85735]">{String(index + 1).padStart(2, '0')}</div><Link href={`/meals/${meal.id}`} className="overflow-hidden rounded-xl"><FoodImage meal={meal} className="aspect-square" /></Link><div><p className="text-[10px] uppercase tracking-[.15em] text-[#8b765f]">{meal.cuisine} · {meal.mealType}</p><Link href={`/meals/${meal.id}`} className="serif mt-1 block text-2xl text-[#173b27]">{meal.name}</Link><p className="mt-1 line-clamp-1 text-sm text-[#74786d]">{meal.description}</p></div><div className="flex items-center gap-3"><span className="text-sm font-bold">{money(meal.priceCents)}</span><button onClick={() => togglePlanMeal(meal.id)} aria-label={`Remove ${meal.name} from weekly preview`} className="rounded-full border border-[#d1cbbd] px-3 py-2 text-xs font-semibold text-[#8c4f38]" data-testid={`button-remove-plan-${meal.id}`}>Remove</button></div></article>) : <EmptyState title="Choose a few meal ideas" text="Add dishes below to shape this local preview. Nothing is scheduled or billed." action="Explore meals" href="/explore" />}</div>
    <section className="mt-8 rounded-[22px] border border-[#ded9cc] bg-[#f1efe7] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="serif text-2xl text-[#173b27]">Edit this preview</h2><p className="mt-1 text-xs text-[#73776a]">{planMeals.length} of {count} meal ideas selected</p></div><Link href="/explore" className="text-sm font-bold text-[#a34d2c]">Browse the menu</Link></div><div className="mt-4 flex flex-wrap gap-2">{availableMeals.filter((meal) => !activeIds.includes(meal.id)).slice(0, 8).map((meal) => <button key={meal.id} onClick={() => togglePlanMeal(meal.id)} disabled={planMeals.length >= count} className="rounded-full border border-[#d1cbbd] bg-[#fbf9f3] px-3 py-2 text-xs font-semibold text-[#35513a] disabled:opacity-50" data-testid={`button-add-plan-${meal.id}`}><Plus size={13} className="mr-1 inline" />{meal.name}</button>)}</div><div className="mt-6 border-t border-[#d9d4c7] pt-5"><p className="text-sm font-semibold text-[#35513a]">Plan controls (preview only)</p><div className="mt-3 flex flex-wrap gap-2">{[['paused', 'Preview pause'], ['skipped', 'Preview skip week'], ['cancelled', 'Preview cancel']].map(([value, label]) => <button key={value} onClick={() => setPreviewAction(value)} aria-pressed={previewAction === value} className={`rounded-full border px-4 py-2.5 text-xs font-semibold ${previewAction === value ? 'border-[#173b27] bg-[#e6eadd] text-[#173b27]' : 'border-[#d1cbbd] bg-[#fbf9f3] text-[#5e6758]'}`} data-testid={`button-${value}-plan-preview`}>{label}</button>)}</div>{previewAction && <p className="mt-3 text-xs text-[#6e7165]" role="status">Preview control selected. No subscription exists, and no real plan was paused, skipped, or canceled.</p>}<p className="mt-3 text-[11px] leading-5 text-[#77786c]">These controls demonstrate the intended experience only. Billing, delivery, and active plans are not configured.</p></div></section>
    <div className="mt-8 flex flex-wrap gap-3"><Link href="/quiz" className="rounded-full bg-[#173b27] px-5 py-3 text-sm font-bold text-white">Adjust my tastes</Link><Link href="/profile" className="rounded-full border border-[#cccabb] px-5 py-3 text-sm font-bold text-[#31513a]">Manage preferences</Link></div>
  </div>;
}

function Profile() {
  const { favorites, meals, toggleFavorite, profile, setProfile } = useApp();
  const favoriteMeals = meals.filter((meal) => favorites.includes(meal.id));
  return <div className="mx-auto max-w-[1100px] px-5 py-10 md:px-10 md:py-16">
    <p className="eyebrow">Your Nomilora, your way</p><h1 className="serif mt-2 text-5xl text-[#173b27]">My tastes</h1><p className="mt-3 max-w-2xl text-[#687164]">Your choices and saved meals live in this browser. No account required.</p>
    <div className="mt-8 grid gap-8 lg:grid-cols-[.8fr_1.2fr]">
      <section className="rounded-[22px] border border-[#dfdacd] bg-[#fbf9f3] p-5 sm:p-7"><div className="flex items-center justify-between"><h2 className="serif text-2xl text-[#173b27]">Taste profile</h2><Link href="/quiz" className="text-sm font-bold text-[#a34d2c]">Edit quiz</Link></div>
        <ProfileChips title="Eating styles" values={profile.eatingStyles} /><ProfileChips title="Dinner priorities" values={profile.goals} /><ProfileChips title="Favorite cuisines" values={profile.cuisines} /><ProfileChips title="Strict allergens" values={profile.strictAllergens} />
        <div className="mt-5 border-t border-[#e6e1d6] pt-4"><p className="text-xs font-bold uppercase tracking-[.13em] text-[#8a7965]">Meals per week</p><p className="mt-2 text-sm text-[#4d5c4a]">{profile.mealsPerWeek}</p></div>
        <div className="mt-5 border-t border-[#e6e1d6] pt-4"><p className="text-xs font-bold uppercase tracking-[.13em] text-[#8a7965]">Dislikes</p><p className="mt-2 text-sm text-[#4d5c4a]">{profile.dislikes.length ? profile.dislikes.join(', ') : 'Not set'}</p></div>
        <button onClick={() => setProfile({ eatingStyles: [], goals: [], cuisines: [], strictAllergens: [], dislikes: [], mealsPerWeek: 'One-time' })} className="mt-6 rounded-full border border-[#d3cfc2] px-4 py-2.5 text-xs font-semibold text-[#8b4e37] hover:bg-[#f5e9e2]">Clear taste profile</button>
        {profile.strictAllergens.length > 0 && <p className="mt-4 rounded-xl bg-[#faeee5] p-3 text-xs leading-5 text-[#794d3a]">Strict allergy selected: recommendations will return no meals because allergen declarations are unknown.</p>}
      </section>
      <section><div className="mb-4 flex items-end justify-between"><div><p className="eyebrow">Kept close</p><h2 className="serif mt-1 text-3xl text-[#173b27]">Saved meals</h2></div><span className="text-xs text-[#77796b]">{favoriteMeals.length} saved</span></div>
        {favoriteMeals.length ? <div className="grid gap-5 sm:grid-cols-2">{favoriteMeals.map((meal) => <div key={meal.id} className="relative"><MealCard meal={meal} /><button onClick={() => toggleFavorite(meal.id)} className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-[#bd5d36] text-white" aria-label={`Remove ${meal.name} from favorites`}><X size={17} /></button></div>)}</div> : <EmptyState title="Your favorites are waiting" text="Save a dish to keep it close for later." action="Explore the menu" href="/explore" />}
      </section>
    </div>
  </div>;
}
function ProfileChips({ title, values }: { title: string; values: string[] }) { return <div className="mt-5 border-t border-[#e6e1d6] pt-4"><p className="text-xs font-bold uppercase tracking-[.13em] text-[#8a7965]">{title}</p><div className="mt-2 flex flex-wrap gap-2">{values.length ? values.map((value) => <span key={value} className="rounded-full bg-[#e9ecdf] px-3 py-1.5 text-xs font-semibold text-[#456047]">{value}</span>) : <span className="text-sm text-[#8a8b7d]">Not set</span>}</div></div>; }

function App() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <AppShell>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/explore" component={Explore} />
              <Route path="/quiz" component={Quiz} />
              <Route path="/meals/:id" component={MealDetails} />
              <Route path="/cart" component={Cart} />
              <Route path="/checkout" component={Checkout} />
              <Route path="/orders" component={Orders} />
              <Route path="/plans" component={Plans} />
              <Route path="/profile" component={Profile} />
              <Route component={NotFound} />
            </Switch>
          </RoutedErrorBoundary>
        </AppShell>
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  </QueryClientProvider>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

export default App;
