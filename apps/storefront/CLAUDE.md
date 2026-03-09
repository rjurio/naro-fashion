# Storefront App

Customer-facing Next.js PWA for Naro Fashion. Runs on port 3000.

## Stack
- Next.js (App Router), TypeScript, Tailwind CSS
- next-themes (Light/Dark/Standard themes via CSS variables)
- next-intl (English + Swahili)

## Pages
- `/` - Homepage (featured categories, new arrivals, flash sales, rental gowns)
- `/products` - Product listing with filters (category, size, color, price, sort)
- `/products/[slug]` - Product detail with gallery, reviews, add-to-cart, wishlist
- `/categories` - Categories index grid
- `/categories/[slug]` - Category detail with filtered products
- `/cart` - Shopping cart with promo codes
- `/checkout` - Multi-step checkout (shipping, delivery, payment, confirm)
- `/flash-sales` - Active flash sales with countdown
- `/rentals` - Browse rentable items
- `/rentals/[slug]` - Rental detail with date picker and booking
- `/shop` - Redirects to `/products`
- `/auth/login` - Login
- `/auth/register` - Register
- `/auth/forgot-password` - Password reset
- `/account` - Dashboard (orders, rentals, wishlist stats)
- `/account/orders` - Order history
- `/account/rentals` - Active and past rentals
- `/account/wishlist` - Saved items
- `/account/settings` - Profile settings
- `/account/id-verification` - National ID upload for rentals
- `/pages/[slug]` - CMS pages (about, contact, faq, terms, privacy, size-guide, shipping-info, returns-exchanges)

## Data Flow
- All pages fetch from NestJS API at `http://localhost:4000/api/v1`
- API client in `lib/api.ts` with domain functions: productsApi, categoriesApi, cartApi, wishlistApi, ordersApi, rentalsApi, reviewsApi, flashSalesApi, cmsApi, authApi, idVerificationApi, shippingApi
- Auth token from `localStorage('token')` auto-injected as Bearer header
- `.env.local` contains `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1`

## Conventions
- Use `@naro/shared` for types/enums, `@naro/ui` for shared components
- All user-facing strings must support i18n (English + Swahili) via `useTranslation()`
- Translation files: `messages/en.json` and `messages/sw.json`
- Brand colors: Black (#1A1A1A), Gold (#D4AF37)
- Mobile-first responsive design
