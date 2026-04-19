/**
 * Seed Naro Fashion tenant with complete real data
 *
 * Run: node packages/database/prisma/seed-tenant.js
 *
 * Seeds: Site settings, CMS pages, banners, hero slides, expense categories,
 *        admin notification preferences, Instagram/Facebook config,
 *        payment methods, and ensures all existing data has tenantId.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Naro Fashion tenant data...\n');

  // Get the Naro Fashion tenant
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'naro-fashion' } });
  if (!tenant) {
    console.error('❌ Tenant "naro-fashion" not found. Run migrate-to-multi-tenant.js first.');
    process.exit(1);
  }
  const tenantId = tenant.id;
  console.log(`Tenant: ${tenant.name} (${tenantId})\n`);

  // ============================================================
  // 1. SITE SETTINGS (business profile, contact, social, config)
  // ============================================================
  console.log('1. Seeding site settings...');

  const settings = [
    // Business Identity
    { key: 'site_name', value: 'Naro Fashion', type: 'string' },
    { key: 'site_name_sw', value: 'Naro Fashion', type: 'string' },
    { key: 'site_description', value: 'Premium Fashion & Clothing in Tanzania', type: 'string' },
    { key: 'site_description_sw', value: 'Mitindo ya Kifahari & Mavazi nchini Tanzania', type: 'string' },
    { key: 'business_type', value: 'Fashion & Clothing', type: 'string' },
    { key: 'business_domain', value: 'narofashion.co.tz', type: 'string' },
    { key: 'currency', value: 'TZS', type: 'string' },
    { key: 'currency_symbol', value: 'TZS', type: 'string' },
    { key: 'default_locale', value: 'en', type: 'string' },
    { key: 'default_theme', value: 'standard', type: 'string' },

    // Contact Info
    { key: 'contact_email', value: 'hello@narofashion.co.tz', type: 'string' },
    { key: 'contact_phone', value: '0753968554', type: 'string' },
    { key: 'contact_address', value: 'Kibada/Kigamboni, Dar es Salaam, Tanzania', type: 'string' },
    { key: 'contact_address_sw', value: 'Kibada/Kigamboni, Dar es Salaam, Tanzania', type: 'string' },
    { key: 'whatsapp_number', value: '255759047287', type: 'string' },

    // Social Media Links
    { key: 'instagram_url', value: 'https://www.instagram.com/narofashion2019/', type: 'string' },
    { key: 'facebook_url', value: 'https://www.facebook.com/narofashion', type: 'string' },
    { key: 'tiktok_url', value: 'https://www.tiktok.com/@narofashion', type: 'string' },
    { key: 'twitter_url', value: '', type: 'string' },
    { key: 'youtube_url', value: '', type: 'string' },

    // Branding Assets
    { key: 'company_logo_url', value: '/logo.jpg', type: 'string' },
    { key: 'company_icon_url', value: '/icon.jpg', type: 'string' },
    { key: 'company_favicon_url', value: '/favicon.jpg', type: 'string' },

    // Instagram Graph API Integration
    { key: 'instagram_access_token', value: '', type: 'string' },
    { key: 'instagram_business_account_id', value: '17841418108905851', type: 'string' },
    { key: 'facebook_app_id', value: '4338851449722487', type: 'string' },
    { key: 'facebook_app_secret', value: '', type: 'string' },
    { key: 'instagram_feed_visible', value: 'true', type: 'boolean' },
    { key: 'instagram_last_sync', value: '', type: 'string' },

    // Store Features
    { key: 'rentals_enabled', value: 'true', type: 'boolean' },
    { key: 'flash_sales_enabled', value: 'true', type: 'boolean' },
    { key: 'referral_program_enabled', value: 'true', type: 'boolean' },
    { key: 'newsletter_enabled', value: 'true', type: 'boolean' },
    { key: 'pos_enabled', value: 'true', type: 'boolean' },
    { key: 'events_gallery_enabled', value: 'true', type: 'boolean' },
    { key: 'id_verification_required', value: 'true', type: 'boolean' },

    // Storefront Display
    { key: 'products_per_page', value: '20', type: 'number' },
    { key: 'featured_products_count', value: '8', type: 'number' },
    { key: 'new_arrivals_count', value: '8', type: 'number' },
    { key: 'show_compare_at_price', value: 'true', type: 'boolean' },
    { key: 'show_stock_count', value: 'false', type: 'boolean' },
    { key: 'low_stock_threshold', value: '5', type: 'number' },

    // Checkout & Payments
    { key: 'minimum_order_amount', value: '10000', type: 'number' },
    { key: 'free_shipping_threshold', value: '200000', type: 'number' },
    { key: 'tax_rate', value: '18', type: 'number' },
    { key: 'tax_included_in_price', value: 'true', type: 'boolean' },
    { key: 'guest_checkout_enabled', value: 'false', type: 'boolean' },

    // Email & Notifications
    { key: 'order_confirmation_email', value: 'true', type: 'boolean' },
    { key: 'shipping_notification_email', value: 'true', type: 'boolean' },
    { key: 'abandoned_cart_email', value: 'true', type: 'boolean' },
    { key: 'review_request_email', value: 'true', type: 'boolean' },

    // Admin Notification Preferences (JSON)
    { key: 'admin_notifications', value: JSON.stringify({
      order_alerts: { email: true, sms: true },
      rental_reminders: { email: true, sms: true },
      low_stock_alerts: { email: true, sms: false },
      new_customer_alerts: { email: true, sms: false },
      review_moderation: { email: true, sms: false },
      payment_received: { email: true, sms: true },
    }), type: 'json' },

    // SEO
    { key: 'meta_title', value: 'Naro Fashion | Premium Fashion & Clothing in Tanzania', type: 'string' },
    { key: 'meta_description', value: 'Shop the latest fashion trends, rent gowns for weddings, and discover premium clothing in Dar es Salaam, Tanzania. M-Pesa, Tigo Pesa accepted.', type: 'string' },
    { key: 'meta_keywords', value: 'fashion, clothing, Tanzania, gown rental, wedding gowns, Dar es Salaam, flash sales, African fashion, kitenge, dresses', type: 'string' },
    { key: 'google_analytics_id', value: '', type: 'string' },
    { key: 'facebook_pixel_id', value: '', type: 'string' },
  ];

  for (const s of settings) {
    const existing = await prisma.siteSetting.findFirst({ where: { tenantId, key: s.key } });
    if (existing) {
      // Only update if value is empty and we have a non-empty value
      if (!existing.value && s.value) {
        await prisma.siteSetting.update({ where: { id: existing.id }, data: { value: s.value } });
      }
    } else {
      await prisma.siteSetting.create({ data: { tenantId, ...s } });
    }
  }
  console.log(`   ✓ ${settings.length} settings seeded`);

  // ============================================================
  // 2. CMS PAGES (About, Contact, FAQ, Terms, Privacy, etc.)
  // ============================================================
  console.log('2. Seeding CMS pages...');

  const pages = [
    {
      title: 'About Us', titleSwahili: 'Kuhusu Sisi',
      slug: 'about',
      isPublished: true,
      content: `<h2>About Naro Fashion</h2>
<p>Naro Fashion is a premium fashion and clothing brand based in Dar es Salaam, Tanzania. We specialize in elegant gowns, dresses, suits, and accessories for all occasions — from weddings to corporate events.</p>

<h3>Our Mission</h3>
<p>To make premium fashion accessible to everyone in Tanzania through affordable purchase and rental options.</p>

<h3>What We Offer</h3>
<ul>
<li><strong>Purchase:</strong> Buy the latest fashion trends at competitive prices</li>
<li><strong>Rentals:</strong> Rent premium gowns and suits for special occasions</li>
<li><strong>Custom Orders:</strong> Get custom-made pieces tailored to your style</li>
<li><strong>Events:</strong> Real wedding galleries showcasing our pieces in action</li>
</ul>

<h3>Why Choose Us?</h3>
<ul>
<li>Premium quality fabrics and craftsmanship</li>
<li>Affordable rental program with 25% down payment</li>
<li>National ID verification for rental security</li>
<li>Multiple payment options: M-Pesa, Tigo Pesa, Airtel Money, Cards</li>
<li>Fast delivery across Tanzania</li>
<li>Dedicated WhatsApp customer support</li>
</ul>

<h3>Visit Us</h3>
<p>📍 Kariakoo, Dar es Salaam, Tanzania<br>
📱 +255 759 047 287<br>
📧 hello@narofashion.co.tz</p>`,
      contentSwahili: `<h2>Kuhusu Naro Fashion</h2>
<p>Naro Fashion ni chapa ya mitindo na mavazi ya kifahari yenye makao yake Dar es Salaam, Tanzania. Tunajishughulisha na gauni nzuri, mavazi, suti, na vifaa kwa matukio yote.</p>`,
    },
    {
      title: 'Contact Us', titleSwahili: 'Wasiliana Nasi',
      slug: 'contact',
      isPublished: true,
      content: `<h2>Get in Touch</h2>
<p>We'd love to hear from you! Reach out to us through any of the following channels:</p>

<h3>📍 Visit Our Store</h3>
<p>Kariakoo Market Area<br>Dar es Salaam, Tanzania</p>

<h3>📱 WhatsApp / Phone</h3>
<p><a href="tel:+255759047287">+255 759 047 287</a></p>

<h3>📧 Email</h3>
<p><a href="mailto:hello@narofashion.co.tz">hello@narofashion.co.tz</a></p>

<h3>🕐 Business Hours</h3>
<p>Monday - Saturday: 9:00 AM - 7:00 PM<br>
Sunday: 10:00 AM - 4:00 PM</p>

<h3>📱 Follow Us</h3>
<p>Instagram: <a href="https://instagram.com/narofashion2019">@narofashion2019</a><br>
Facebook: <a href="https://facebook.com/narofashion">Naro Fashion</a></p>`,
      contentSwahili: `<h2>Wasiliana Nasi</h2><p>Tungependa kusikia kutoka kwako!</p>`,
    },
    {
      title: 'FAQ', titleSwahili: 'Maswali Yanayoulizwa Mara kwa Mara',
      slug: 'faq',
      isPublished: true,
      content: `<h2>Frequently Asked Questions</h2>

<h3>How do I place an order?</h3>
<p>Browse our products, add items to your cart, and proceed to checkout. You can pay using M-Pesa, Tigo Pesa, Airtel Money, or bank card.</p>

<h3>How does gown rental work?</h3>
<p>1. Browse our rental collection<br>
2. Register and verify your National ID<br>
3. Pay 25% down payment to reserve<br>
4. Pick up the item on your scheduled date<br>
5. Return within the agreed period<br>
6. Get your deposit refund after inspection</p>

<h3>What is the rental deposit?</h3>
<p>A refundable security deposit is required for all rentals. This is returned after the item passes inspection upon return.</p>

<h3>How long can I rent a gown?</h3>
<p>Rental periods range from 1-30 days depending on the item. A 7-day buffer is required between rental bookings.</p>

<h3>Do you deliver outside Dar es Salaam?</h3>
<p>Yes! We deliver across Tanzania. Shipping costs vary by region — standard delivery to major cities takes 2-4 days.</p>

<h3>Can I return a purchased item?</h3>
<p>Items can be returned within 7 days of delivery if unworn, with original tags attached. Custom orders are non-returnable.</p>

<h3>How do I track my order?</h3>
<p>Log into your account and go to "My Orders" to see your order status and tracking information.</p>`,
      contentSwahili: `<h2>Maswali Yanayoulizwa Mara kwa Mara</h2><p>Pata majibu ya maswali unayouliza mara kwa mara.</p>`,
    },
    {
      title: 'Terms & Conditions', titleSwahili: 'Sheria na Masharti',
      slug: 'terms',
      isPublished: true,
      content: `<h2>Terms & Conditions</h2>
<p><em>Last updated: March 2026</em></p>

<h3>1. General</h3>
<p>These terms govern your use of the Naro Fashion website and services. By using our services, you agree to these terms.</p>

<h3>2. Orders & Payments</h3>
<ul>
<li>All prices are in Tanzanian Shillings (TZS) and include applicable taxes</li>
<li>Orders are confirmed only after successful payment</li>
<li>We accept M-Pesa, Tigo Pesa, Airtel Money, and bank cards</li>
</ul>

<h3>3. Rentals</h3>
<ul>
<li>National ID verification is required for all rentals</li>
<li>A 25% non-refundable down payment secures your reservation</li>
<li>Security deposits are refundable upon satisfactory return</li>
<li>Late returns incur a fee of TZS 10,000 per day</li>
<li>Damage to rented items will be deducted from the security deposit</li>
</ul>

<h3>4. Shipping & Delivery</h3>
<ul>
<li>Delivery times are estimates and may vary</li>
<li>Free shipping on orders above TZS 200,000 within Dar es Salaam</li>
</ul>

<h3>5. Returns</h3>
<ul>
<li>Purchased items may be returned within 7 days, unworn with tags</li>
<li>Custom and altered items are non-returnable</li>
<li>Rental items must be returned by the agreed date</li>
</ul>`,
      contentSwahili: `<h2>Sheria na Masharti</h2><p>Sheria hizi zinaongoza matumizi yako ya tovuti na huduma za Naro Fashion.</p>`,
    },
    {
      title: 'Privacy Policy', titleSwahili: 'Sera ya Faragha',
      slug: 'privacy',
      isPublished: true,
      content: `<h2>Privacy Policy</h2>
<p><em>Last updated: March 2026</em></p>

<h3>Information We Collect</h3>
<p>We collect information you provide when creating an account, placing orders, or contacting us: name, email, phone number, shipping address, and National ID (for rentals only).</p>

<h3>How We Use Your Information</h3>
<ul>
<li>Process and fulfill your orders and rental bookings</li>
<li>Verify your identity for rental services</li>
<li>Send order confirmations and shipping updates</li>
<li>Improve our products and services</li>
<li>Send promotional emails (with your consent)</li>
</ul>

<h3>Data Security</h3>
<p>We implement industry-standard security measures to protect your personal information. National ID documents are stored securely and only accessed for verification purposes.</p>

<h3>Contact</h3>
<p>For privacy concerns, contact us at hello@narofashion.co.tz</p>`,
      contentSwahili: `<h2>Sera ya Faragha</h2><p>Tunalinda taarifa zako binafsi.</p>`,
    },
    {
      title: 'Shipping Information', titleSwahili: 'Taarifa za Usafirishaji',
      slug: 'shipping-info',
      isPublished: true,
      content: `<h2>Shipping Information</h2>

<h3>Delivery Zones & Rates</h3>
<table>
<tr><th>Zone</th><th>Standard</th><th>Express</th><th>Time</th></tr>
<tr><td>Dar es Salaam</td><td>TZS 3,000</td><td>TZS 8,000</td><td>1-2 days</td></tr>
<tr><td>Major Cities (Arusha, Mwanza, Dodoma, Mbeya, Zanzibar)</td><td>TZS 8,000</td><td>TZS 15,000</td><td>2-4 days</td></tr>
<tr><td>Other Regions</td><td>TZS 12,000</td><td>—</td><td>5-7 days</td></tr>
</table>

<h3>Free Shipping</h3>
<p>Orders above TZS 200,000 qualify for free standard shipping within Dar es Salaam.</p>

<h3>Pickup Points</h3>
<p>You can also pick up your order from:<br>
📍 Naro Fashion Kariakoo — Kariakoo Market, Msimbazi Street<br>
📍 Naro Fashion Mlimani City — Mlimani City Mall, Sam Nujoma Road</p>

<h3>Rental Delivery</h3>
<p>Rental items can be picked up in-store or shipped. Shipped rentals include transport receipts. Available transport modes: Air, Bus, Train, Courier.</p>`,
      contentSwahili: `<h2>Taarifa za Usafirishaji</h2><p>Tunafikisha bidhaa nchi nzima ya Tanzania.</p>`,
    },
    {
      title: 'Returns & Exchanges', titleSwahili: 'Urudishaji na Ubadilishaji',
      slug: 'returns-exchanges',
      isPublished: true,
      content: `<h2>Returns & Exchanges</h2>

<h3>Purchase Returns</h3>
<ul>
<li>Items may be returned within 7 days of delivery</li>
<li>Items must be unworn, unwashed, with original tags attached</li>
<li>Custom-made and altered items are final sale</li>
<li>Refunds are processed within 3-5 business days to original payment method</li>
</ul>

<h3>Rental Returns</h3>
<ul>
<li>Rental items must be returned by the agreed return date</li>
<li>Late returns incur TZS 10,000 per day late fee</li>
<li>All accessories must be returned (veil, shoes, jewellery, etc.)</li>
<li>Items will be inspected upon return — damages deducted from deposit</li>
<li>Deposit refund processed within 48 hours after inspection</li>
</ul>

<h3>How to Return</h3>
<p>Contact us via WhatsApp (+255 759 047 287) to initiate a return. We'll arrange pickup or you can drop off at our Kariakoo store.</p>`,
      contentSwahili: `<h2>Urudishaji na Ubadilishaji</h2><p>Sera yetu ya urudishaji ni rahisi na wazi.</p>`,
    },
    {
      title: 'Size Guide', titleSwahili: 'Mwongozo wa Ukubwa',
      slug: 'size-guide',
      isPublished: true,
      content: `<h2>Size Guide</h2>

<h3>Women's Dresses & Gowns</h3>
<table>
<tr><th>Size</th><th>Bust (cm)</th><th>Waist (cm)</th><th>Hips (cm)</th></tr>
<tr><td>XS</td><td>80-84</td><td>60-64</td><td>86-90</td></tr>
<tr><td>S</td><td>84-88</td><td>64-68</td><td>90-94</td></tr>
<tr><td>M</td><td>88-92</td><td>68-72</td><td>94-98</td></tr>
<tr><td>L</td><td>92-96</td><td>72-76</td><td>98-102</td></tr>
<tr><td>XL</td><td>96-100</td><td>76-80</td><td>102-106</td></tr>
</table>

<h3>Men's Suits</h3>
<table>
<tr><th>Size</th><th>Chest (cm)</th><th>Waist (cm)</th></tr>
<tr><td>36</td><td>91</td><td>76</td></tr>
<tr><td>38</td><td>96</td><td>81</td></tr>
<tr><td>40</td><td>101</td><td>86</td></tr>
<tr><td>42</td><td>106</td><td>91</td></tr>
<tr><td>44</td><td>111</td><td>96</td></tr>
</table>

<h3>Tips</h3>
<ul>
<li>Measure over undergarments for accuracy</li>
<li>For rental gowns, we recommend booking a fitting appointment</li>
<li>If between sizes, size up for comfort</li>
<li>Contact us on WhatsApp for sizing advice</li>
</ul>`,
      contentSwahili: `<h2>Mwongozo wa Ukubwa</h2><p>Pima vizuri kabla ya kununua au kukodi.</p>`,
    },
  ];

  for (const page of pages) {
    const existing = await prisma.page.findFirst({ where: { tenantId, slug: page.slug } });
    if (!existing) {
      await prisma.page.create({ data: { tenantId, ...page } });
    }
  }
  console.log(`   ✓ ${pages.length} CMS pages seeded`);

  // ============================================================
  // 3. TENANT BRANDING (update with complete info)
  // ============================================================
  console.log('3. Updating tenant branding...');

  await prisma.tenantBranding.update({
    where: { tenantId },
    data: {
      companyName: 'Naro Fashion',
      tagline: 'Premium Fashion & Clothing in Tanzania',
      logoUrl: '/logo.jpg',
      iconUrl: '/icon.jpg',
      faviconUrl: '/favicon.jpg',
      colorPrimary: '#D4AF37',
      colorSecondary: '#1A1A1A',
      colorAccent: '#D4AF37',
      fontHeading: 'Playfair Display',
      fontBody: 'Inter',
      whatsappNumber: '255759047287',
      socialLinks: {
        instagram: 'https://www.instagram.com/narofashion2019/',
        facebook: 'https://www.facebook.com/narofashion',
        tiktok: 'https://www.tiktok.com/@narofashion',
        twitter: '',
      },
      metaTitle: 'Naro Fashion | Premium Fashion & Clothing in Tanzania',
      metaDescription: 'Shop the latest fashion trends, rent gowns for weddings, and discover premium clothing in Dar es Salaam, Tanzania.',
    },
  });
  console.log('   ✓ Branding updated');

  // ============================================================
  // 4. PAYMENT METHODS (with tenantId)
  // ============================================================
  console.log('4. Seeding payment methods...');

  const paymentMethods = [
    { name: 'M-Pesa', code: 'MPESA', description: 'Pay with Vodacom M-Pesa mobile money', sortOrder: 1 },
    { name: 'Tigo Pesa', code: 'TIGOPESA', description: 'Pay with Tigo Pesa mobile money', sortOrder: 2 },
    { name: 'Airtel Money', code: 'AIRTEL', description: 'Pay with Airtel Money', sortOrder: 3 },
    { name: 'Selcom Pesa', code: 'SELCOM', description: 'Pay with Selcom Pesa', sortOrder: 4 },
    { name: 'Halopesa', code: 'HALOTEL', description: 'Pay with Halotel Halopesa', sortOrder: 5 },
    { name: 'Visa', code: 'VISA', description: 'Pay with Visa credit/debit card', sortOrder: 6 },
    { name: 'Mastercard', code: 'MASTERCARD', description: 'Pay with Mastercard credit/debit card', sortOrder: 7 },
    { name: 'Cash on Delivery', code: 'COD', description: 'Pay when you receive your order (Dar es Salaam only)', sortOrder: 8 },
    { name: 'Bank Transfer', code: 'BANK', description: 'Direct bank transfer (CRDB, NMB, NBC)', sortOrder: 9 },
  ];

  for (const pm of paymentMethods) {
    const existing = await prisma.paymentMethod.findFirst({ where: { tenantId, code: pm.code } });
    if (!existing) {
      await prisma.paymentMethod.create({ data: { tenantId, ...pm } });
    }
  }
  console.log(`   ✓ ${paymentMethods.length} payment methods seeded`);

  // ============================================================
  // 5. EXPENSE CATEGORIES (for financial tracking)
  // ============================================================
  console.log('5. Seeding expense categories...');

  const expenseCategories = [
    { name: 'Rent & Utilities', categoryType: 'OPERATING', description: 'Store rent, electricity, water', sortOrder: 1 },
    { name: 'Salaries & Wages', categoryType: 'OPERATING', description: 'Employee salaries and wages', sortOrder: 2 },
    { name: 'Inventory Purchases', categoryType: 'COGS', description: 'Cost of purchasing inventory/stock', sortOrder: 3 },
    { name: 'Shipping & Logistics', categoryType: 'OPERATING', description: 'Delivery and transportation costs', sortOrder: 4 },
    { name: 'Marketing & Advertising', categoryType: 'OPERATING', description: 'Social media ads, promotions, flyers', sortOrder: 5 },
    { name: 'Cleaning & Laundry', categoryType: 'OPERATING', description: 'Dry cleaning for rental items', sortOrder: 6 },
    { name: 'Equipment & Supplies', categoryType: 'OPERATING', description: 'Hangers, bags, mannequins, packaging', sortOrder: 7 },
    { name: 'Technology & Software', categoryType: 'OPERATING', description: 'Internet, phone, POS system, website', sortOrder: 8 },
    { name: 'Taxes & Licenses', categoryType: 'TAX', description: 'Business licenses, TRA taxes', sortOrder: 9 },
    { name: 'Insurance', categoryType: 'OPERATING', description: 'Business and inventory insurance', sortOrder: 10 },
    { name: 'Repairs & Maintenance', categoryType: 'OPERATING', description: 'Store repairs, alterations equipment', sortOrder: 11 },
    { name: 'Miscellaneous', categoryType: 'OTHER', description: 'Other business expenses', sortOrder: 12 },
  ];

  for (const ec of expenseCategories) {
    const existing = await prisma.expenseCategory.findFirst({ where: { tenantId, name: ec.name } });
    if (!existing) {
      await prisma.expenseCategory.create({ data: { tenantId, ...ec } });
    }
  }
  console.log(`   ✓ ${expenseCategories.length} expense categories seeded`);

  // ============================================================
  // 6. ENSURE ADMIN USERS HAVE TENANT ROLES
  // ============================================================
  console.log('6. Assigning roles to admin users...');

  const adminUsers = await prisma.adminUser.findMany({ where: { tenantId } });
  const superAdminRole = await prisma.role.findFirst({ where: { tenantId, name: 'SUPER_ADMIN' } });

  if (superAdminRole) {
    for (const admin of adminUsers) {
      if (admin.role === 'SUPER_ADMIN') {
        const hasRole = await prisma.adminUserRole.findFirst({
          where: { adminUserId: admin.id, roleId: superAdminRole.id },
        });
        if (!hasRole) {
          await prisma.adminUserRole.create({
            data: { adminUserId: admin.id, roleId: superAdminRole.id },
          });
        }
      }
    }
  }
  console.log(`   ✓ ${adminUsers.length} admin users checked`);

  // ============================================================
  // 7. BACKFILL tenantId for any remaining NULL records
  // ============================================================
  console.log('7. Backfilling any remaining NULL tenantId records...');

  const tables = [
    'User', 'AdminUser', 'AdminActivityLog', 'LoginAttempt', 'CustomerIDDocument',
    'Category', 'Product', 'ProductVariant', 'Order', 'Payment', 'Shipment', 'Invoice',
    'ShippingZone', 'Review', 'RentalOrder', 'RentalChecklistTemplate', 'RentalPolicy',
    'FlashSale', 'ReferralCode', 'Banner', 'HeroSlide', 'Page', 'SizeGuide', 'SiteSetting',
    'InstagramPost', 'NewsletterSubscriber', 'Newsletter', 'PickupPoint',
    'InventoryTransaction', 'ExpenseCategory', 'BusinessExpense', 'FinancialPeriod',
    'Role', 'PosSession', 'HeldSale', 'Layaway', 'PosExchange',
    'PromoCode', 'CustomerEvent', 'AbandonedCartReminder', 'PaymentMethod', 'ContactSubmission',
  ];

  let totalFixed = 0;
  for (const table of tables) {
    try {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "tenantId" = $1 WHERE "tenantId" IS NULL`,
        tenantId
      );
      if (result > 0) {
        console.log(`   ✓ ${table}: ${result} rows fixed`);
        totalFixed += result;
      }
    } catch {
      // Table might not exist or have no tenantId column
    }
  }
  if (totalFixed === 0) {
    console.log('   ✓ All records already have tenantId');
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n✅ Naro Fashion tenant seeding complete!');
  console.log('\n📋 Summary:');
  console.log(`   • ${settings.length} site settings`);
  console.log(`   • ${pages.length} CMS pages`);
  console.log(`   • ${paymentMethods.length} payment methods`);
  console.log(`   • ${expenseCategories.length} expense categories`);
  console.log('   • Branding updated with social links & meta');
  console.log('   • Instagram/Facebook API IDs configured');
  console.log('\n🔑 Admin Login: admin@narofashion.co.tz / admin123');
  console.log('🔑 Platform Login: platform@naro.co.tz / Admin123');
  console.log('\n📱 Social Media:');
  console.log('   • Instagram: @narofashion2019');
  console.log('   • Facebook: facebook.com/narofashion');
  console.log('   • TikTok: @narofashion');
  console.log('   • WhatsApp: +255 759 047 287');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
