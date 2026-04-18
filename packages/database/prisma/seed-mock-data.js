/**
 * Seed Naro Fashion tenant with realistic mock/sample data
 *
 * Run: node packages/database/prisma/seed-mock-data.js
 *
 * Seeds: Customers, orders, rentals, reviews, flash sales, events,
 *        expenses, inventory, POS sessions, referrals, promo codes,
 *        newsletter subscribers, contact submissions
 */

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

// Use bcrypt to match what the API auth service expects (bcrypt.compare)
function hashSync(password) {
  return bcrypt.hashSync(password, 10);
}

// Helper: random item from array
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// Helper: random int in range
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
// Helper: random date in past N days
const pastDate = (maxDays) => {
  const d = new Date();
  d.setDate(d.getDate() - randInt(1, maxDays));
  d.setHours(randInt(8, 20), randInt(0, 59));
  return d;
};
// Helper: future date in N days
const futureDate = (minDays, maxDays) => {
  const d = new Date();
  d.setDate(d.getDate() + randInt(minDays, maxDays));
  return d;
};
// Helper: generate unique order number with random suffix
const uid = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const orderNum = () => `NF-${new Date().getFullYear()}-${uid()}`;
const rentalNum = () => `RNT-${new Date().getFullYear()}-${uid()}`;

async function main() {
  console.log('🎭 Seeding mock data for Naro Fashion...\n');

  const tenant = await prisma.tenant.findUnique({ where: { slug: 'naro-fashion' } });
  if (!tenant) { console.error('❌ Tenant not found'); process.exit(1); }
  const tenantId = tenant.id;

  // Get existing products & variants
  const products = await prisma.product.findMany({
    where: { tenantId },
    include: { variants: true, images: true, category: true },
  });
  if (products.length === 0) { console.error('❌ No products found. Run seed first.'); process.exit(1); }

  const categories = await prisma.category.findMany({ where: { tenantId } });
  const shippingZones = await prisma.shippingZone.findMany({ where: { tenantId } });
  const adminUsers = await prisma.adminUser.findMany({ where: { tenantId } });
  const adminId = adminUsers[0]?.id;

  // ============================================================
  // 1. SAMPLE CUSTOMERS
  // ============================================================
  console.log('1. Creating sample customers...');

  const customerData = [
    { firstName: 'Amina', lastName: 'Hassan', email: 'amina.hassan@gmail.com', phone: '+255712345001', city: 'Dar es Salaam', region: 'Dar es Salaam' },
    { firstName: 'Grace', lastName: 'Mwakasege', email: 'grace.mwakasege@yahoo.com', phone: '+255713456002', city: 'Dar es Salaam', region: 'Dar es Salaam' },
    { firstName: 'Fatma', lastName: 'Abdallah', email: 'fatma.abdallah@hotmail.com', phone: '+255714567003', city: 'Arusha', region: 'Arusha' },
    { firstName: 'Sarah', lastName: 'Kimaro', email: 'sarah.kimaro@gmail.com', phone: '+255715678004', city: 'Mwanza', region: 'Mwanza' },
    { firstName: 'Neema', lastName: 'Mushi', email: 'neema.mushi@gmail.com', phone: '+255716789005', city: 'Dodoma', region: 'Dodoma' },
    { firstName: 'Zainab', lastName: 'Mohamed', email: 'zainab.mohamed@gmail.com', phone: '+255717890006', city: 'Zanzibar', region: 'Zanzibar' },
    { firstName: 'Joyce', lastName: 'Mhando', email: 'joyce.mhando@gmail.com', phone: '+255718901007', city: 'Mbeya', region: 'Mbeya' },
    { firstName: 'Mary', lastName: 'Lyimo', email: 'mary.lyimo@gmail.com', phone: '+255719012008', city: 'Dar es Salaam', region: 'Dar es Salaam' },
    { firstName: 'John', lastName: 'Mwakalinga', email: 'john.mwakalinga@gmail.com', phone: '+255720123009', city: 'Dar es Salaam', region: 'Dar es Salaam' },
    { firstName: 'Peter', lastName: 'Mkamba', email: 'peter.mkamba@gmail.com', phone: '+255721234010', city: 'Arusha', region: 'Arusha' },
    { firstName: 'Anna', lastName: 'Shirima', email: 'anna.shirima@gmail.com', phone: '+255722345011', city: 'Dar es Salaam', region: 'Dar es Salaam' },
    { firstName: 'Happiness', lastName: 'Ngowi', email: 'happiness.ngowi@gmail.com', phone: '+255723456012', city: 'Moshi', region: 'Kilimanjaro' },
    { firstName: 'Rehema', lastName: 'Juma', email: 'rehema.juma@gmail.com', phone: '+255724567013', city: 'Dar es Salaam', region: 'Dar es Salaam' },
    { firstName: 'Emanuel', lastName: 'Komba', email: 'emanuel.komba@gmail.com', phone: '+255725678014', city: 'Dodoma', region: 'Dodoma' },
    { firstName: 'Elizabeth', lastName: 'Swai', email: 'elizabeth.swai@gmail.com', phone: '+255726789015', city: 'Dar es Salaam', region: 'Dar es Salaam' },
  ];

  const customers = [];
  for (const c of customerData) {
    const existing = await prisma.user.findFirst({
      where: { tenantId, OR: [{ email: c.email }, { phone: c.phone }] },
    });
    if (existing) { customers.push(existing); continue; }
    const user = await prisma.user.create({
      data: {
        tenantId,
        email: c.email,
        phone: c.phone,
        passwordHash: hashSync('Demo1234'),
        firstName: c.firstName,
        lastName: c.lastName,
        isVerified: Math.random() > 0.3,
        isActive: true,
        preferredLocale: Math.random() > 0.5 ? 'en' : 'sw',
        addresses: {
          create: [{
            label: 'Home',
            fullName: `${c.firstName} ${c.lastName}`,
            phone: c.phone,
            street: pick(['Bagamoyo Rd', 'Ali Hassan Mwinyi Rd', 'Samora Ave', 'Nyerere Rd', 'Morogoro Rd', 'Mandela Rd', 'Kilwa Rd', 'Obama Dr']),
            city: c.city,
            region: c.region,
            country: 'Tanzania',
            isDefault: true,
          }],
        },
      },
    });
    customers.push(user);
  }
  console.log(`   ✓ ${customers.length} customers`);

  // ============================================================
  // 2. SAMPLE ORDERS (mix of statuses)
  // ============================================================
  console.log('2. Creating sample orders...');

  const orderStatuses = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'DELIVERED', 'DELIVERED', 'CANCELLED'];
  const paymentMethods = ['MPESA', 'TIGO_PESA', 'AIRTEL_MONEY', 'CASH', 'CARD'];
  const paymentStatuses = { PENDING: 'PENDING', CONFIRMED: 'COMPLETED', PROCESSING: 'COMPLETED', SHIPPED: 'COMPLETED', DELIVERED: 'COMPLETED', CANCELLED: 'REFUNDED' };

  let ordersCreated = 0;
  for (let i = 0; i < 25; i++) {
    const customer = pick(customers);
    const address = await prisma.address.findFirst({ where: { userId: customer.id } });
    const product = pick(products);
    const variant = product.variants[0];
    if (!variant) continue;

    const qty = randInt(1, 3);
    const unitPrice = Number(variant.price);
    const subtotal = unitPrice * qty;
    const shipping = pick([0, 3000, 8000, 12000]);
    const total = subtotal + shipping;
    const status = pick(orderStatuses);

    await prisma.order.create({
      data: {
        tenantId,
        orderNumber: orderNum(),
        userId: customer.id,
        addressId: address?.id,
        status,
        subtotal,
        shippingCost: shipping,
        discount: 0,
        total,
        paymentMethod: pick(paymentMethods),
        paymentStatus: paymentStatuses[status] || 'PENDING',
        channel: Math.random() > 0.2 ? 'ONLINE' : 'POS',
        createdAt: pastDate(90),
        items: {
          create: [{
            productId: product.id,
            variantId: variant.id,
            quantity: qty,
            unitPrice,
            total: subtotal,
          }],
        },
      },
    });
    ordersCreated++;
  }
  console.log(`   ✓ ${ordersCreated} orders`);

  // ============================================================
  // 3. SAMPLE PAYMENTS (linked to orders)
  // ============================================================
  console.log('3. Creating sample payments...');

  const paidOrders = await prisma.order.findMany({
    where: { tenantId, paymentStatus: 'COMPLETED' },
    take: 15,
  });

  for (const order of paidOrders) {
    const existing = await prisma.payment.findFirst({ where: { orderId: order.id } });
    if (existing) continue;
    await prisma.payment.create({
      data: {
        tenantId,
        orderId: order.id,
        amount: order.total,
        method: order.paymentMethod,
        status: 'COMPLETED',
        transactionRef: `TXN-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
        createdAt: order.createdAt,
      },
    });
  }
  console.log(`   ✓ ${paidOrders.length} payments`);

  // ============================================================
  // 4. SAMPLE RENTAL ORDERS
  // ============================================================
  console.log('4. Creating sample rental orders...');

  const rentalProducts = products.filter(p => p.availabilityMode !== 'PURCHASE_ONLY');
  const rentalStatuses = ['PENDING_ID_VERIFICATION', 'DOWN_PAYMENT_PAID', 'FULLY_PAID', 'READY_FOR_PICKUP', 'ACTIVE', 'RETURNED', 'CLOSED'];
  const tanzaniaRegions = ['Dar es Salaam', 'Arusha', 'Mwanza', 'Dodoma', 'Mbeya', 'Zanzibar', 'Tanga', 'Morogoro', 'Kilimanjaro', 'Iringa'];
  const venues = ['Serena Hotel', 'Hyatt Regency', 'Mlimani City Conference', 'White Sands Hotel', 'Slipway', 'Julius Nyerere Centre', 'St. Joseph Cathedral', 'Karimjee Hall'];

  let rentalsCreated = 0;
  for (let i = 0; i < 12; i++) {
    const customer = pick(customers);
    const product = pick(rentalProducts);
    if (!product) continue;
    const variant = product.variants[0];
    if (!variant) continue;

    const startDate = i < 6 ? pastDate(60) : futureDate(3, 30);
    const returnDate = new Date(startDate);
    returnDate.setDate(returnDate.getDate() + randInt(2, 5));
    const pickupDate = new Date(startDate);
    pickupDate.setDate(pickupDate.getDate() - 1);

    const totalPrice = Number(product.rentalPricePerDay || 30000) * randInt(2, 5);
    const downPayment = Math.round(totalPrice * 0.25);
    const deposit = Number(product.rentalDepositAmount || 80000);
    const status = pick(rentalStatuses);

    await prisma.rentalOrder.create({
      data: {
        tenantId,
        rentalNumber: rentalNum(),
        userId: customer.id,
        productId: product.id,
        variantId: variant.id,
        startDate,
        returnDate,
        pickupDate,
        actualReturnDate: status === 'RETURNED' || status === 'CLOSED' ? returnDate : null,
        totalRentalPrice: totalPrice,
        downPaymentAmount: downPayment,
        damageDeposit: deposit,
        status,
        isReadyForPickup: ['READY_FOR_PICKUP', 'ACTIVE', 'RETURNED', 'CLOSED'].includes(status),
        pickupTime: pick(['9:00 AM', '10:00 AM', '11:00 AM', '2:00 PM', '3:00 PM']),
        weddingDate: futureDate(1, 14),
        weddingLocation: pick(venues),
        weddingRegion: pick(tanzaniaRegions),
        deliveryModality: pick(['HAND_PICKED', 'SHIPPED']),
        createdAt: pastDate(90),
      },
    });
    rentalsCreated++;
  }
  console.log(`   ✓ ${rentalsCreated} rental orders`);

  // ============================================================
  // 5. SAMPLE REVIEWS
  // ============================================================
  console.log('5. Creating sample reviews...');

  const reviewTexts = [
    { title: 'Absolutely stunning!', comment: 'The gown was even more beautiful in person. Perfect for my wedding day. Naro Fashion really delivers quality!', rating: 5 },
    { title: 'Great quality', comment: 'Very well made, the fabric is premium quality. Shipping was fast to Dar es Salaam.', rating: 5 },
    { title: 'Good value for money', comment: 'Nice dress for the price. Colors are vibrant and true to the pictures. Would buy again.', rating: 4 },
    { title: 'Perfect fit', comment: 'Ordered my usual size and it fits perfectly. The stitching and finish are excellent.', rating: 5 },
    { title: 'Beautiful but runs small', comment: 'Lovely design and material, but it runs a bit small. I recommend sizing up. Otherwise, very happy!', rating: 4 },
    { title: 'Loved the rental experience', comment: 'Rented a gown for my friend\'s wedding. The process was smooth, the dress was immaculate. Will rent again!', rating: 5 },
    { title: 'Decent quality', comment: 'The shirt is okay for the price. Material could be a bit thicker, but overall good value.', rating: 3 },
    { title: 'My wife loved it!', comment: 'Bought this as a surprise for my wife. She absolutely loves it. Thank you Naro Fashion!', rating: 5 },
    { title: 'Fast delivery', comment: 'Ordered on Monday, received on Wednesday. Very impressed with the speed. Product is as described.', rating: 4 },
    { title: 'Amazing customer service', comment: 'Had a question about sizing and the team on WhatsApp was super helpful. Great experience overall.', rating: 5 },
    { title: 'Return was easy', comment: 'Rental return process was hassle-free. They inspected everything quickly and refunded my deposit the next day.', rating: 4 },
    { title: 'Highly recommend', comment: 'I have bought three items from Naro Fashion now. Quality is consistent and prices are fair for Tanzania.', rating: 5 },
  ];

  let reviewsCreated = 0;
  for (let i = 0; i < 20; i++) {
    const customer = pick(customers);
    const product = pick(products);
    const review = pick(reviewTexts);

    const existing = await prisma.review.findFirst({
      where: { userId: customer.id, productId: product.id },
    });
    if (existing) continue;

    await prisma.review.create({
      data: {
        tenantId,
        userId: customer.id,
        productId: product.id,
        rating: review.rating,
        title: review.title,
        comment: review.comment,
        isVerified: Math.random() > 0.3,
        isApproved: Math.random() > 0.2,
        createdAt: pastDate(120),
      },
    });
    reviewsCreated++;
  }

  // Update product rating stats
  for (const product of products) {
    const stats = await prisma.review.aggregate({
      where: { productId: product.id, isApproved: true },
      _avg: { rating: true },
      _count: { _all: true },
    });
    if (stats._count._all > 0) {
      await prisma.product.update({
        where: { id: product.id },
        data: { avgRating: stats._avg.rating || 0, reviewCount: stats._count._all },
      });
    }
  }
  console.log(`   ✓ ${reviewsCreated} reviews (ratings updated)`);

  // ============================================================
  // 6. FLASH SALES
  // ============================================================
  console.log('6. Creating flash sales...');

  const flashSale = await prisma.flashSale.findFirst({ where: { tenantId, title: 'Eid Sale — Up to 40% Off!' } });
  if (!flashSale) {
    await prisma.flashSale.create({
      data: {
        tenantId,
        title: 'Eid Sale — Up to 40% Off!',
        titleSwahili: 'Punguzo la Eid — Hadi 40%!',
        description: 'Celebrate Eid with massive discounts on dresses, gowns, and accessories.',
        startDate: new Date(),
        endDate: futureDate(5, 10),
        isActive: true,
        items: {
          create: products.slice(0, 3).map(p => ({
            productId: p.id,
            salePrice: Math.round(Number(p.basePrice) * 0.65),
          })),
        },
      },
    });
  }

  const flashSale2 = await prisma.flashSale.findFirst({ where: { tenantId, title: 'Weekend Special' } });
  if (!flashSale2) {
    await prisma.flashSale.create({
      data: {
        tenantId,
        title: 'Weekend Special',
        titleSwahili: 'Ofa ya Wikendi',
        description: 'Special weekend prices on selected items. Don\'t miss out!',
        startDate: futureDate(1, 3),
        endDate: futureDate(4, 7),
        isActive: true,
        items: {
          create: products.slice(2, 4).map(p => ({
            productId: p.id,
            salePrice: Math.round(Number(p.basePrice) * 0.8),
          })),
        },
      },
    });
  }
  console.log('   ✓ Flash sales created');

  // ============================================================
  // 7. PROMO CODES
  // ============================================================
  console.log('7. Creating promo codes...');

  const promoCodes = [
    { code: 'WELCOME10', description: 'Welcome discount — 10% off first order', discountType: 'PERCENTAGE', discountValue: 10, minOrderAmount: 50000, maxDiscountAmount: 30000, maxUses: 100, maxUsesPerUser: 1 },
    { code: 'NARO20K', description: 'TZS 20,000 off orders above TZS 150,000', discountType: 'FIXED', discountValue: 20000, minOrderAmount: 150000, maxUses: 50, maxUsesPerUser: 1 },
    { code: 'BRIDE15', description: '15% off wedding gown rentals', discountType: 'PERCENTAGE', discountValue: 15, minOrderAmount: 100000, maxDiscountAmount: 75000, maxUses: null, maxUsesPerUser: 1 },
    { code: 'VIP25', description: 'VIP 25% discount', discountType: 'PERCENTAGE', discountValue: 25, minOrderAmount: 200000, maxDiscountAmount: 100000, maxUses: 10, maxUsesPerUser: 1 },
  ];

  for (const pc of promoCodes) {
    const existing = await prisma.promoCode.findFirst({ where: { tenantId, code: pc.code } });
    if (!existing) {
      await prisma.promoCode.create({
        data: { tenantId, ...pc, validFrom: new Date(), validUntil: futureDate(60, 180) },
      });
    }
  }
  console.log(`   ✓ ${promoCodes.length} promo codes`);

  // ============================================================
  // 8. REFERRAL CODES
  // ============================================================
  console.log('8. Creating referral codes...');

  let refCreated = 0;
  for (const customer of customers.slice(0, 5)) {
    const existing = await prisma.referralCode.findFirst({ where: { userId: customer.id } });
    if (existing) continue;
    const code = `REF-${customer.firstName.toUpperCase().slice(0, 3)}${randInt(100, 999)}`;
    await prisma.referralCode.create({
      data: { tenantId, userId: customer.id, code, discount: 5000 },
    });
    refCreated++;
  }
  console.log(`   ✓ ${refCreated} referral codes`);

  // ============================================================
  // 9. CUSTOMER EVENTS (wedding galleries)
  // ============================================================
  console.log('9. Creating customer events...');

  const events = [
    {
      title: 'Amina & Hassan\'s Wedding',
      slug: 'amina-hassan-wedding-2026',
      description: 'A beautiful traditional Swahili wedding at Serena Hotel. Amina wore our Gold Evening Gown and looked absolutely stunning!',
      eventDate: pastDate(45),
      location: 'Serena Hotel, Dar es Salaam',
      customerName: 'Amina Hassan',
      status: 'APPROVED',
      isFeatured: true,
    },
    {
      title: 'Grace & James — Garden Reception',
      slug: 'grace-james-garden-reception',
      description: 'An intimate garden ceremony in Masaki. Grace chose our Royal Wedding Gown for the special day.',
      eventDate: pastDate(30),
      location: 'Masaki Gardens, Dar es Salaam',
      customerName: 'Grace Mwakasege',
      status: 'APPROVED',
      isFeatured: true,
    },
    {
      title: 'Sarah\'s Engagement Party',
      slug: 'sarah-engagement-party',
      description: 'A vibrant engagement celebration in Mwanza. Sarah rented our Pink Cocktail Dress.',
      eventDate: pastDate(15),
      location: 'Tilapia Hotel, Mwanza',
      customerName: 'Sarah Kimaro',
      status: 'APPROVED',
      isFeatured: false,
    },
  ];

  for (const event of events) {
    const existing = await prisma.customerEvent.findFirst({ where: { tenantId, slug: event.slug } });
    if (existing) continue;
    const customer = customers.find(c => c.firstName === event.customerName.split(' ')[0]);
    await prisma.customerEvent.create({
      data: {
        tenantId,
        ...event,
        userId: customer?.id,
        productId: pick(rentalProducts)?.id,
        approvedAt: new Date(),
        socialLinks: { instagram: `@${event.customerName.toLowerCase().replace(/[^a-z]/g, '')}` },
        coverImageUrl: '/uploads/events/wedding-cover.jpg',
      },
    });
  }
  console.log(`   ✓ ${events.length} customer events`);

  // ============================================================
  // 10. NEWSLETTER SUBSCRIBERS
  // ============================================================
  console.log('10. Creating newsletter subscribers...');

  const subscriberEmails = [
    'fashion.lover@gmail.com', 'bridal.dreams@yahoo.com', 'style.tz@gmail.com',
    'dar.fashionista@gmail.com', 'mwanza.bride@gmail.com', 'zanzibar.chic@gmail.com',
    'kilimanjaro.style@gmail.com', 'dodoma.trends@gmail.com',
  ];

  let subsCreated = 0;
  for (const email of subscriberEmails) {
    const existing = await prisma.newsletterSubscriber.findFirst({ where: { tenantId, email } });
    if (!existing) {
      await prisma.newsletterSubscriber.create({
        data: { tenantId, email, source: 'STOREFRONT', isActive: true },
      });
      subsCreated++;
    }
  }
  // Also subscribe the customers
  for (const c of customers.slice(0, 8)) {
    if (!c.email) continue;
    const existing = await prisma.newsletterSubscriber.findFirst({ where: { tenantId, email: c.email } });
    if (!existing) {
      await prisma.newsletterSubscriber.create({
        data: { tenantId, email: c.email, name: `${c.firstName} ${c.lastName}`, source: 'STOREFRONT', isActive: true },
      });
      subsCreated++;
    }
  }
  console.log(`   ✓ ${subsCreated} newsletter subscribers`);

  // ============================================================
  // 11. BUSINESS EXPENSES (last 3 months)
  // ============================================================
  console.log('11. Creating business expenses...');

  const expCategories = await prisma.expenseCategory.findMany({ where: { tenantId } });
  const expMap = {};
  for (const ec of expCategories) expMap[ec.name] = ec.id;

  const months = ['2026-01', '2026-02', '2026-03'];
  const expenseItems = [
    { cat: 'Rent & Utilities', amounts: [800000, 800000, 800000], vendor: 'Kariakoo Properties' },
    { cat: 'Salaries & Wages', amounts: [2400000, 2400000, 2500000], vendor: 'Staff Payroll' },
    { cat: 'Inventory Purchases', amounts: [3500000, 2800000, 4200000], vendor: 'Various Suppliers' },
    { cat: 'Shipping & Logistics', amounts: [180000, 220000, 195000], vendor: 'DHL / Bus Cargo' },
    { cat: 'Marketing & Advertising', amounts: [150000, 200000, 250000], vendor: 'Facebook / Instagram Ads' },
    { cat: 'Cleaning & Laundry', amounts: [120000, 95000, 140000], vendor: 'Prestige Dry Cleaners' },
    { cat: 'Equipment & Supplies', amounts: [85000, 0, 120000], vendor: 'Kariakoo Wholesale' },
    { cat: 'Technology & Software', amounts: [50000, 50000, 50000], vendor: 'Vodacom / TTCL' },
    { cat: 'Taxes & Licenses', amounts: [0, 450000, 0], vendor: 'TRA / Municipal' },
  ];

  let expCreated = 0;
  for (const item of expenseItems) {
    const catId = expMap[item.cat];
    if (!catId) continue;
    for (let m = 0; m < months.length; m++) {
      if (item.amounts[m] === 0) continue;
      const existing = await prisma.businessExpense.findFirst({
        where: { tenantId, categoryId: catId, period: months[m], vendor: item.vendor },
      });
      if (existing) continue;
      const day = String(randInt(1, 28)).padStart(2, '0');
      const d = new Date(`${months[m]}-${day}T12:00:00`);
      await prisma.businessExpense.create({
        data: {
          tenantId,
          categoryId: catId,
          amount: item.amounts[m],
          description: `${item.cat} — ${months[m]}`,
          vendor: item.vendor,
          expenseDate: d,
          period: months[m],
          createdBy: adminId,
        },
      });
      expCreated++;
    }
  }
  console.log(`   ✓ ${expCreated} business expenses`);

  // ============================================================
  // 12. INVENTORY TRANSACTIONS
  // ============================================================
  console.log('12. Creating inventory transactions...');

  let invCreated = 0;
  for (const product of products) {
    for (const variant of product.variants) {
      // Initial restock
      await prisma.inventoryTransaction.create({
        data: {
          tenantId,
          productId: product.id,
          variantId: variant.id,
          type: 'RESTOCK',
          quantityBefore: 0,
          quantityChange: variant.stock,
          quantityAfter: variant.stock,
          unitCost: Number(product.purchasePrice || product.basePrice) * 0.6,
          totalValue: Number(product.purchasePrice || product.basePrice) * 0.6 * variant.stock,
          reference: 'Initial stock',
          note: `Initial inventory for ${variant.name}`,
          performedBy: adminId,
          createdAt: pastDate(120),
        },
      });
      invCreated++;

      // Some sales
      if (Math.random() > 0.4) {
        const soldQty = randInt(1, 3);
        await prisma.inventoryTransaction.create({
          data: {
            tenantId,
            productId: product.id,
            variantId: variant.id,
            type: 'SALE',
            quantityBefore: variant.stock,
            quantityChange: -soldQty,
            quantityAfter: variant.stock - soldQty,
            reference: `Order sale`,
            performedBy: adminId,
            createdAt: pastDate(30),
          },
        });
        invCreated++;
      }
    }
  }
  console.log(`   ✓ ${invCreated} inventory transactions`);

  // ============================================================
  // 13. CONTACT SUBMISSIONS
  // ============================================================
  console.log('13. Creating contact submissions...');

  const contacts = [
    { name: 'Mariam Bakari', email: 'mariam.b@gmail.com', phone: '+255741111111', subject: 'Wedding Gown Inquiry', message: 'Hello, I am getting married in May and would like to know about your wedding gown rental packages. Do you offer fittings? What sizes are available? Thank you.' },
    { name: 'David Mhina', email: 'david.mhina@yahoo.com', phone: '+255742222222', subject: 'Custom Suit Order', message: 'I need a custom-made suit for my graduation ceremony. Can you make a navy blue suit with specific measurements? What is the turnaround time?' },
    { name: 'Janet Matemu', email: 'janet.m@hotmail.com', subject: 'Delivery to Mbeya', message: 'Do you deliver to Mbeya? I saw some dresses on your website I would like to order. How long does delivery take and what are the costs?' },
    { name: 'Hassan Omar', email: 'hassan.omar@gmail.com', phone: '+255744444444', subject: 'Bulk Order for Event', message: 'We are organizing a corporate event and need 20 matching outfits for our staff. Can you handle bulk orders? What discounts do you offer?' },
    { name: 'Lucy Swai', email: 'lucy.s@gmail.com', subject: 'Return Request', message: 'I received my order but the size is too small. I would like to exchange it for a larger size. Order #NF-2026-01005. Please advise on the return process.', status: 'IN_PROGRESS' },
  ];

  for (const c of contacts) {
    const existing = await prisma.contactSubmission.findFirst({ where: { tenantId, email: c.email, subject: c.subject } });
    if (existing) continue;
    await prisma.contactSubmission.create({
      data: { tenantId, ...c, status: c.status || 'PENDING', createdAt: pastDate(30) },
    });
  }
  console.log(`   ✓ ${contacts.length} contact submissions`);

  // ============================================================
  // 14. ID VERIFICATION DOCUMENTS
  // ============================================================
  console.log('14. Creating ID verification records...');

  let idCreated = 0;
  for (const customer of customers.slice(0, 6)) {
    const existing = await prisma.customerIDDocument.findFirst({ where: { tenantId, userId: customer.id } });
    if (existing) continue;
    const status = pick(['APPROVED', 'APPROVED', 'APPROVED', 'PENDING', 'REJECTED']);
    await prisma.customerIDDocument.create({
      data: {
        tenantId,
        userId: customer.id,
        idType: 'NATIONAL_ID',
        idNumber: `${randInt(19700000, 20050000)}${randInt(10000, 99999)}-${randInt(10000, 99999)}`,
        frontImageUrl: '/uploads/id-docs/sample-id-front.jpg',
        backImageUrl: '/uploads/id-docs/sample-id-back.jpg',
        verificationStatus: status,
        verifiedAt: status === 'APPROVED' ? pastDate(30) : null,
        rejectionReason: status === 'REJECTED' ? 'Image is blurry, please resubmit a clearer photo' : null,
      },
    });
    idCreated++;
  }
  console.log(`   ✓ ${idCreated} ID verifications`);

  // ============================================================
  // 15. WISHLIST ITEMS
  // ============================================================
  console.log('15. Creating wishlist items...');

  let wishCreated = 0;
  for (const customer of customers.slice(0, 8)) {
    const wishProducts = products.sort(() => Math.random() - 0.5).slice(0, randInt(1, 3));
    for (const product of wishProducts) {
      const existing = await prisma.wishlistItem.findFirst({
        where: { userId: customer.id, productId: product.id },
      });
      if (!existing) {
        await prisma.wishlistItem.create({
          data: { userId: customer.id, productId: product.id },
        });
        wishCreated++;
      }
    }
  }
  console.log(`   ✓ ${wishCreated} wishlist items`);

  // ============================================================
  // 16. CART ITEMS (active carts)
  // ============================================================
  console.log('16. Creating cart items...');

  let cartCreated = 0;
  for (const customer of customers.slice(5, 9)) {
    const product = pick(products);
    const variant = product.variants[0];
    if (!variant) continue;
    const existing = await prisma.cartItem.findFirst({ where: { userId: customer.id, variantId: variant.id } });
    if (!existing) {
      await prisma.cartItem.create({
        data: { userId: customer.id, productId: product.id, variantId: variant.id, quantity: randInt(1, 2) },
      });
      cartCreated++;
    }
  }
  console.log(`   ✓ ${cartCreated} cart items`);

  // ============================================================
  // SUMMARY
  // ============================================================
  const totalOrders = await prisma.order.count({ where: { tenantId } });
  const totalRentals = await prisma.rentalOrder.count({ where: { tenantId } });
  const totalCustomers = await prisma.user.count({ where: { tenantId } });
  const totalReviews = await prisma.review.count({ where: { tenantId } });

  console.log('\n✅ Mock data seeding complete!');
  console.log('\n📊 Totals:');
  console.log(`   • ${totalCustomers} customers`);
  console.log(`   • ${totalOrders} orders`);
  console.log(`   • ${totalRentals} rental orders`);
  console.log(`   • ${totalReviews} reviews`);
  console.log(`   • Flash sales, promo codes, referrals, expenses, events all seeded`);
}

main()
  .catch((e) => { console.error('❌ Failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
