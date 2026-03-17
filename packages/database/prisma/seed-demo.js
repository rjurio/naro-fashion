// Demo data seed for Naro Fashion
// Run: node packages/database/prisma/seed-demo.js

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

function cuid() {
  return 'demo' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
}

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  console.log('Seeding demo data...');

  // --- Existing IDs ---
  const products = await prisma.product.findMany({ select: { id: true, name: true, basePrice: true, rentalPricePerDay: true, availabilityMode: true, categoryId: true } });
  const variants = await prisma.productVariant.findMany({ select: { id: true, productId: true, name: true, price: true, stock: true } });
  const categories = await prisma.category.findMany({ select: { id: true, name: true } });
  const adminUser = await prisma.adminUser.findFirst({ select: { id: true } });
  const zones = await prisma.shippingZone.findMany({ select: { id: true, name: true } });

  console.log(`Found ${products.length} products, ${variants.length} variants, ${categories.length} categories`);

  // --- 1. Create Customers ---
  const passwordHash = await bcrypt.hash('Customer123', 12);
  const customerData = [
    { firstName: 'Amina', lastName: 'Mwangi', email: 'amina@example.com', phone: '+255712345001' },
    { firstName: 'Fatima', lastName: 'Hassan', email: 'fatima@example.com', phone: '+255713345002' },
    { firstName: 'Zuhura', lastName: 'Juma', email: 'zuhura@example.com', phone: '+255714345003' },
    { firstName: 'Grace', lastName: 'Kimaro', email: 'grace@example.com', phone: '+255715345004' },
    { firstName: 'Neema', lastName: 'Mushi', email: 'neema@example.com', phone: '+255716345005' },
    { firstName: 'Saida', lastName: 'Abdallah', email: 'saida@example.com', phone: '+255717345006' },
    { firstName: 'Baraka', lastName: 'Mfinanga', email: 'baraka@example.com', phone: '+255718345007' },
    { firstName: 'Halima', lastName: 'Kiplagat', email: 'halima@example.com', phone: '+255719345008' },
    { firstName: 'Diana', lastName: 'Lema', email: 'diana@example.com', phone: '+255720345009' },
    { firstName: 'Joseph', lastName: 'Mollel', email: 'joseph@example.com', phone: '+255721345010' },
    { firstName: 'Rehema', lastName: 'Salum', email: 'rehema@example.com', phone: '+255722345011' },
    { firstName: 'Beatrice', lastName: 'Mwakasege', email: 'beatrice@example.com', phone: '+255723345012' },
  ];

  const users = [];
  for (const c of customerData) {
    const user = await prisma.user.upsert({
      where: { email: c.email },
      update: {},
      create: { id: cuid(), ...c, passwordHash, isVerified: true, isActive: true },
    });
    users.push(user);
  }
  console.log(`Created ${users.length} customers`);

  // --- 2. Create Addresses ---
  const regions = ['Dar es Salaam', 'Arusha', 'Dodoma', 'Mwanza', 'Tanga', 'Mbeya', 'Morogoro', 'Zanzibar'];
  const streets = ['Bagamoyo Rd', 'Samora Ave', 'Ali Hassan Mwinyi Rd', 'Nyerere Rd', 'Uhuru St', 'Sokoine Dr', 'Lumumba St', 'Mkwepu St'];
  const addresses = [];
  for (const user of users) {
    const region = randomItem(regions);
    const addr = await prisma.address.create({
      data: {
        id: cuid(),
        userId: user.id,
        label: 'Home',
        fullName: `${user.firstName} ${user.lastName}`,
        phone: user.phone || '+255700000000',
        street: `${Math.floor(Math.random() * 200) + 1} ${randomItem(streets)}`,
        city: region === 'Dar es Salaam' ? 'Dar es Salaam' : region,
        region,
        country: 'Tanzania',
        isDefault: true,
      },
    });
    addresses.push(addr);
  }
  console.log(`Created ${addresses.length} addresses`);

  // --- 3. Create Orders (last 90 days) ---
  const orderStatuses = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'DELIVERED', 'DELIVERED'];
  const paymentMethods = ['MOBILE_MONEY', 'MOBILE_MONEY', 'CARD', 'CASH_ON_DELIVERY', 'BANK_TRANSFER'];
  const paymentStatuses = ['PAID', 'PAID', 'PAID', 'PENDING', 'PAID'];
  const channels = ['ONLINE', 'ONLINE', 'ONLINE', 'POS'];

  const orders = [];
  const now = new Date();
  for (let i = 0; i < 45; i++) {
    const user = randomItem(users);
    const addr = addresses.find(a => a.userId === user.id);
    const orderDate = randomDate(new Date(now.getTime() - 90 * 24 * 3600000), now);
    const channel = randomItem(channels);
    const status = randomItem(orderStatuses);
    const payStatus = status === 'DELIVERED' ? 'PAID' : randomItem(paymentStatuses);

    // Pick 1-3 items
    const numItems = Math.floor(Math.random() * 3) + 1;
    const selectedVariants = [];
    for (let j = 0; j < numItems; j++) {
      const v = randomItem(variants.filter(vr => vr.stock > 0));
      if (v && !selectedVariants.find(sv => sv.id === v.id)) selectedVariants.push(v);
    }
    if (selectedVariants.length === 0) continue;

    let subtotal = 0;
    const items = selectedVariants.map(v => {
      const qty = Math.floor(Math.random() * 2) + 1;
      const itemTotal = Number(v.price) * qty;
      subtotal += itemTotal;
      return { variantId: v.id, productId: v.productId, quantity: qty, unitPrice: Number(v.price), total: itemTotal };
    });

    const shippingCost = channel === 'POS' ? 0 : randomItem([0, 5000, 10000, 15000]);
    const discount = Math.random() > 0.7 ? Math.floor(subtotal * 0.1) : 0;
    const total = subtotal + shippingCost - discount;

    const orderNumber = `NF-${String(1000 + i).padStart(4, '0')}`;
    const existing = await prisma.order.findUnique({ where: { orderNumber } });
    if (existing) { orders.push(existing); continue; }
    const order = await prisma.order.create({
      data: {
        id: cuid(),
        orderNumber,
        userId: user.id,
        addressId: addr?.id,
        status,
        subtotal,
        shippingCost,
        discount,
        total,
        paymentMethod: randomItem(paymentMethods),
        paymentStatus: payStatus,
        channel,
        customerName: `${user.firstName} ${user.lastName}`,
        customerPhone: user.phone,
        createdAt: orderDate,
        updatedAt: orderDate,
        items: {
          create: items.map(it => ({
            id: cuid(),
            productId: it.productId,
            variantId: it.variantId,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            total: it.total,
          })),
        },
      },
    });
    orders.push(order);
  }
  console.log(`Created ${orders.length} orders`);

  // --- 4. Create Payments for delivered orders ---
  const deliveredOrders = await prisma.order.findMany({ where: { status: 'DELIVERED', paymentStatus: 'PAID' }, select: { id: true, total: true, paymentMethod: true, createdAt: true } });
  let paymentCount = 0;
  for (const o of deliveredOrders) {
    try {
      await prisma.payment.create({
        data: {
          id: cuid(),
          orderId: o.id,
          amount: o.total,
          method: o.paymentMethod,
          status: 'COMPLETED',
          transactionRef: `TXN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: o.createdAt,
        },
      });
      paymentCount++;
    } catch (e) { /* skip duplicates */ }
  }
  console.log(`Created ${paymentCount} payments`);

  // --- 5. Create Rental Orders ---
  const rentalProducts = products.filter(p => p.availabilityMode === 'BOTH' || p.availabilityMode === 'RENTAL_ONLY');
  const rentalStatuses = ['CONFIRMED', 'DISPATCHED', 'ACTIVE', 'RETURNED', 'RETURNED', 'OVERDUE'];

  const rentals = [];
  for (let i = 0; i < 18; i++) {
    const user = randomItem(users);
    const product = randomItem(rentalProducts);
    const productVariants = variants.filter(v => v.productId === product.id);
    if (productVariants.length === 0) continue;
    const variant = randomItem(productVariants);

    const startDate = randomDate(new Date(now.getTime() - 60 * 24 * 3600000), new Date(now.getTime() + 15 * 24 * 3600000));
    const rentalDays = Math.floor(Math.random() * 5) + 3;
    const returnDate = new Date(startDate.getTime() + rentalDays * 24 * 3600000);
    const pickupDate = new Date(startDate.getTime() - 2 * 24 * 3600000);
    const rentalPrice = Number(product.rentalPricePerDay || 30000) * rentalDays;
    const downPayment = Math.floor(rentalPrice * 0.25);
    const damageDeposit = Math.floor(rentalPrice * 0.5);

    let status;
    if (returnDate < now && Math.random() > 0.3) {
      status = 'RETURNED';
    } else if (returnDate < now) {
      status = 'OVERDUE';
    } else if (startDate <= now && returnDate >= now) {
      status = 'ACTIVE';
    } else if (pickupDate <= now && startDate > now) {
      status = randomItem(['CONFIRMED', 'DISPATCHED']);
    } else {
      status = 'CONFIRMED';
    }

    const rentalNumber = `RNT-${String(100 + i).padStart(4, '0')}`;
    const existingRental = await prisma.rentalOrder.findUnique({ where: { rentalNumber } });
    if (existingRental) { rentals.push(existingRental); continue; }
    const weddingRegions = ['Dar es Salaam', 'Arusha', 'Dodoma', 'Mwanza', 'Tanga', 'Mbeya'];
    const weddingLocations = ['Diamond Jubilee Hall', 'Mlimani City Conference', 'Hyatt Regency', 'Serena Hotel', 'Mt. Meru Hotel', 'Blue Pearl Hotel'];

    try {
      const rental = await prisma.rentalOrder.create({
        data: {
          id: cuid(),
          rentalNumber,
          userId: user.id,
          productId: product.id,
          variantId: variant.id,
          startDate,
          returnDate,
          pickupDate,
          actualReturnDate: status === 'RETURNED' ? new Date(returnDate.getTime() + (Math.random() > 0.5 ? 24 * 3600000 : -24 * 3600000)) : null,
          totalRentalPrice: rentalPrice,
          downPaymentAmount: downPayment,
          damageDeposit,
          lateFee: status === 'OVERDUE' ? Math.floor(rentalPrice * 0.1) : 0,
          status,
          deliveryModality: randomItem(['HAND_PICKED', 'SHIPPED']),
          pickupTime: randomItem(['09:00', '10:00', '11:00', '14:00', '15:00']),
          weddingDate: new Date(startDate.getTime() + 24 * 3600000),
          weddingLocation: randomItem(weddingLocations),
          weddingRegion: randomItem(weddingRegions),
          isReadyForPickup: ['DISPATCHED', 'ACTIVE'].includes(status),
          notes: status === 'OVERDUE' ? 'Customer not reachable by phone' : null,
          createdAt: new Date(pickupDate.getTime() - 7 * 24 * 3600000),
          updatedAt: now,
        },
      });
      rentals.push(rental);
    } catch (e) {
      console.log(`Rental ${rentalNumber} skipped:`, e.message?.slice(0, 80));
    }
  }
  console.log(`Created ${rentals.length} rental orders`);

  // --- 6. Create Reviews ---
  const reviewTitles = [
    'Absolutely stunning!', 'Beautiful quality', 'Perfect fit', 'Exceeded expectations',
    'Good value for money', 'Love this piece', 'Great for the wedding', 'Decent quality',
    'Not bad at all', 'Could be better', 'Amazing craftsmanship', 'Very elegant',
    'My wife loved it', 'Will order again', 'Fast delivery too!',
  ];
  const reviewComments = [
    'The fabric quality is amazing. I wore it to a wedding and got so many compliments!',
    'Fits perfectly as described. The color is exactly what I expected.',
    'Great purchase! The material feels premium and the stitching is excellent.',
    'I was hesitant to order online but this exceeded my expectations completely.',
    'Good quality for the price. Would recommend to friends and family.',
    'The design is beautiful and unique. Very fashionable.',
    'Delivered on time and well packaged. The dress is gorgeous.',
    'Comfortable to wear and looks exactly like the pictures.',
    'I bought this for my sister\'s wedding. She absolutely loved it!',
    'Premium quality. You can tell this was made with care and attention to detail.',
  ];

  let reviewCount = 0;
  for (let i = 0; i < 30; i++) {
    const user = randomItem(users);
    const product = randomItem(products);
    const rating = randomItem([4, 4, 4, 5, 5, 5, 5, 3, 3, 2]);
    try {
      await prisma.review.create({
        data: {
          id: cuid(),
          userId: user.id,
          productId: product.id,
          rating,
          title: randomItem(reviewTitles),
          comment: randomItem(reviewComments),
          isVerified: Math.random() > 0.3,
          isApproved: Math.random() > 0.2,
          createdAt: randomDate(new Date(now.getTime() - 90 * 24 * 3600000), now),
        },
      });
      reviewCount++;
    } catch (e) { /* skip unique constraint violations */ }
  }
  console.log(`Created ${reviewCount} reviews`);

  // --- 7. Create Wishlist Items ---
  let wishlistCount = 0;
  for (const user of users.slice(0, 8)) {
    const numItems = Math.floor(Math.random() * 3) + 1;
    for (let j = 0; j < numItems; j++) {
      const product = randomItem(products);
      try {
        await prisma.wishlistItem.create({
          data: { id: cuid(), userId: user.id, productId: product.id },
        });
        wishlistCount++;
      } catch (e) { /* skip duplicates */ }
    }
  }
  console.log(`Created ${wishlistCount} wishlist items`);

  // --- 8. Create Cart Items ---
  let cartCount = 0;
  for (const user of users.slice(0, 5)) {
    const variant = randomItem(variants);
    try {
      await prisma.cartItem.create({
        data: { id: cuid(), userId: user.id, productId: variant.productId, variantId: variant.id, quantity: Math.floor(Math.random() * 2) + 1 },
      });
      cartCount++;
    } catch (e) { /* skip */ }
  }
  console.log(`Created ${cartCount} cart items`);

  // --- 9. Create Flash Sales ---
  const flashSales = [];
  const saleNames = [
    { title: 'Eid Fashion Sale', titleSwahili: 'Punguzo la Idi' },
    { title: 'Weekend Special', titleSwahili: 'Maalum ya Wikendi' },
    { title: 'New Season Deals', titleSwahili: 'Ofa za Msimu Mpya' },
  ];
  for (let i = 0; i < 3; i++) {
    const sale = saleNames[i];
    const startDate = i === 0
      ? new Date(now.getTime() - 2 * 24 * 3600000)
      : i === 1
        ? new Date(now.getTime() + 3 * 24 * 3600000)
        : new Date(now.getTime() - 30 * 24 * 3600000);
    const endDate = new Date(startDate.getTime() + 7 * 24 * 3600000);

    const fs = await prisma.flashSale.create({
      data: {
        id: cuid(),
        title: sale.title,
        titleSwahili: sale.titleSwahili,
        startDate,
        endDate,
        isActive: endDate > now,
        items: {
          create: products.slice(0, 2 + i).map(p => ({
            id: cuid(),
            productId: p.id,
            salePrice: Math.floor(Number(p.basePrice) * 0.8),
          })),
        },
      },
    });
    flashSales.push(fs);
  }
  console.log(`Created ${flashSales.length} flash sales`);

  // --- 10. Create Business Expenses ---
  const expenseCategories = await prisma.expenseCategory.findMany({ select: { id: true, name: true } });
  let expenseCount = 0;
  const expenseDescriptions = {
    'Rent': ['Shop rent - Kariakoo', 'Warehouse rent - Mbagala', 'Office space - CBD'],
    'Utilities': ['TANESCO electricity bill', 'Water bill', 'Internet - Tigo Fiber'],
    'Marketing': ['Facebook Ads campaign', 'Instagram influencer', 'Flyers printing', 'WhatsApp Business API'],
    'Salaries': ['Staff salaries - March', 'Staff salaries - February', 'Part-time tailor wages'],
    'Shipping': ['DHL parcel shipment', 'Bus cargo - Arusha', 'Boda boda deliveries'],
    'Supplies': ['Packaging materials', 'Sewing thread & needles', 'Mannequins purchase'],
    'Maintenance': ['Shop AC repair', 'Computer repair', 'POS terminal maintenance'],
    'Transport': ['Fuel costs', 'Driver salary', 'Vehicle maintenance'],
  };

  for (let i = 0; i < 35; i++) {
    const cat = randomItem(expenseCategories);
    const descriptions = expenseDescriptions[cat.name] || [`${cat.name} expense`];
    const date = randomDate(new Date(now.getTime() - 90 * 24 * 3600000), now);
    const amount = randomItem([25000, 50000, 75000, 100000, 150000, 200000, 350000, 500000, 800000, 1500000]);

    try {
      await prisma.businessExpense.create({
        data: {
          id: cuid(),
          categoryId: cat.id,
          description: randomItem(descriptions),
          amount,
          date,
          notes: Math.random() > 0.6 ? 'Paid via M-Pesa' : null,
          createdAt: date,
        },
      });
      expenseCount++;
    } catch (e) { /* skip */ }
  }
  console.log(`Created ${expenseCount} business expenses`);

  // --- 11. Create Inventory Transactions ---
  let invCount = 0;
  const invTypes = ['PURCHASE', 'PURCHASE', 'SALE', 'SALE', 'ADJUSTMENT', 'RETURN'];
  for (let i = 0; i < 25; i++) {
    const variant = randomItem(variants);
    const product = products.find(p => p.id === variant.productId);
    const type = randomItem(invTypes);
    const qty = type === 'PURCHASE' ? Math.floor(Math.random() * 10) + 5 : -(Math.floor(Math.random() * 3) + 1);
    const date = randomDate(new Date(now.getTime() - 60 * 24 * 3600000), now);

    try {
      await prisma.inventoryTransaction.create({
        data: {
          id: cuid(),
          productId: variant.productId,
          variantId: variant.id,
          type,
          quantity: qty,
          reason: type === 'PURCHASE' ? 'Stock replenishment' : type === 'SALE' ? 'Customer order' : type === 'RETURN' ? 'Customer return' : 'Stock count adjustment',
          performedBy: adminUser?.id || 'system',
          createdAt: date,
        },
      });
      invCount++;
    } catch (e) { /* skip */ }
  }
  console.log(`Created ${invCount} inventory transactions`);

  // --- 12. Create Customer Events ---
  const eventData = [
    { title: 'Amina & Hassan Wedding', location: 'Diamond Jubilee Hall, Dar es Salaam', date: new Date(now.getTime() - 30 * 24 * 3600000), coverImage: '/uploads/events/wedding-1.jpg' },
    { title: 'Grace\'s Graduation Ceremony', location: 'University of Dar es Salaam', date: new Date(now.getTime() - 15 * 24 * 3600000), coverImage: '/uploads/events/graduation-1.jpg' },
    { title: 'Fatima & Ali Nikah', location: 'Serena Hotel, Arusha', date: new Date(now.getTime() - 7 * 24 * 3600000), coverImage: '/uploads/events/nikah-1.jpg' },
    { title: 'Neema\'s Birthday Gala', location: 'Hyatt Regency, Dar es Salaam', date: new Date(now.getTime() + 10 * 24 * 3600000), coverImage: '/uploads/events/birthday-1.jpg' },
  ];

  let eventCount = 0;
  for (let i = 0; i < eventData.length; i++) {
    const ev = eventData[i];
    const user = users[i];
    const product = randomItem(products);

    try {
      const event = await prisma.customerEvent.create({
        data: {
          id: cuid(),
          title: ev.title,
          userId: user.id,
          productId: product.id,
          eventDate: ev.date,
          location: ev.location,
          description: `A beautiful event featuring Naro Fashion designs.`,
          coverImageUrl: ev.coverImage,
          isApproved: i < 3,
          isAdminCreated: i === 0,
          socialLinks: JSON.stringify({ instagram: `@${user.firstName.toLowerCase()}_fashion` }),
          createdAt: new Date(ev.date.getTime() - 14 * 24 * 3600000),
        },
      });

      // Add gallery media to each event
      const galleryImages = [
        '/uploads/events/gallery-1.jpg',
        '/uploads/events/gallery-2.jpg',
        '/uploads/events/gallery-3.jpg',
        '/uploads/events/gallery-4.jpg',
      ];
      const numMedia = Math.min(2 + i, galleryImages.length);
      for (let m = 0; m < numMedia; m++) {
        await prisma.eventMedia.create({
          data: {
            id: cuid(),
            eventId: event.id,
            url: galleryImages[m],
            mediaType: 'IMAGE',
            altText: `${ev.title} - Photo ${m + 1}`,
            sortOrder: m,
          },
        });
      }

      eventCount++;
    } catch (e) {
      console.log(`Event skipped:`, e.message?.slice(0, 80));
    }
  }
  console.log(`Created ${eventCount} customer events`);

  // --- 13. Create Pages ---
  const pages = [
    { title: 'About Us', titleSwahili: 'Kuhusu Sisi', slug: 'about-us', content: '<h2>Welcome to Naro Fashion</h2><p>We are Tanzania\'s premier online fashion destination, offering the finest clothing, gowns, and wedding attire. Founded in Dar es Salaam, we bring elegance and style to every occasion.</p><p>Our mission is to empower Tanzanians through fashion, providing high-quality, affordable, and trendy clothing for every occasion.</p>', isPublished: true },
    { title: 'Contact Us', titleSwahili: 'Wasiliana Nasi', slug: 'contact', content: '<h2>Get in Touch</h2><p>Visit us at: Kariakoo, Dar es Salaam, Tanzania</p><p>Phone: +255 712 345 678</p><p>Email: info@narofashion.co.tz</p><p>Hours: Mon-Sat 9am-6pm, Sun 10am-4pm</p>', isPublished: true },
    { title: 'Shipping Policy', titleSwahili: 'Sera ya Usafirishaji', slug: 'shipping-policy', content: '<h2>Shipping & Delivery</h2><p>We deliver across Tanzania. Dar es Salaam orders arrive within 1-2 business days. Other regions take 3-7 business days.</p><p>Free shipping on orders above TZS 200,000.</p>', isPublished: true },
    { title: 'Return Policy', titleSwahili: 'Sera ya Kurudisha', slug: 'return-policy', content: '<h2>Returns & Exchanges</h2><p>We accept returns within 7 days of delivery. Items must be unworn with original tags attached.</p><p>Rental items must be returned clean and in original condition.</p>', isPublished: true },
  ];

  let pageCount = 0;
  for (const page of pages) {
    try {
      await prisma.page.upsert({
        where: { slug: page.slug },
        update: {},
        create: { id: cuid(), ...page },
      });
      pageCount++;
    } catch (e) { /* skip */ }
  }
  console.log(`Created ${pageCount} pages`);

  // --- 14. Add more Staff AdminUsers ---
  const staffData = [
    { firstName: 'Sarah', lastName: 'Mwanga', email: 'sarah@narofashion.co.tz', role: 'MANAGER' },
    { firstName: 'John', lastName: 'Masasi', email: 'john@narofashion.co.tz', role: 'STAFF' },
  ];
  const adminHash = await bcrypt.hash('Staff123', 12);
  for (const staff of staffData) {
    try {
      await prisma.adminUser.upsert({
        where: { email: staff.email },
        update: {},
        create: { id: cuid(), ...staff, passwordHash: adminHash, isActive: true },
      });
    } catch (e) { /* skip */ }
  }
  console.log(`Created ${staffData.length} staff users`);

  // --- 15. Create Login Attempts (activity data) ---
  let loginCount = 0;
  for (let i = 0; i < 20; i++) {
    const date = randomDate(new Date(now.getTime() - 7 * 24 * 3600000), now);
    await prisma.loginAttempt.create({
      data: {
        id: cuid(),
        email: randomItem(['admin@narofashion.co.tz', 'sarah@narofashion.co.tz', 'john@narofashion.co.tz']),
        isAdmin: true,
        success: Math.random() > 0.1,
        ipAddress: `196.41.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        attemptedAt: date,
      },
    });
    loginCount++;
  }
  console.log(`Created ${loginCount} login attempts`);

  // --- 16. Update product ratings ---
  for (const product of products) {
    const reviews = await prisma.review.findMany({
      where: { productId: product.id, isApproved: true },
      select: { rating: true },
    });
    if (reviews.length > 0) {
      const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
      await prisma.product.update({
        where: { id: product.id },
        data: { avgRating: Math.round(avg * 10) / 10, reviewCount: reviews.length },
      });
    }
  }
  console.log('Updated product ratings');

  // --- Summary ---
  console.log('\n--- Demo Data Summary ---');
  const counts = {
    'Customers': await prisma.user.count(),
    'Admin Users': await prisma.adminUser.count(),
    'Orders': await prisma.order.count(),
    'Order Items': await prisma.orderItem.count(),
    'Rental Orders': await prisma.rentalOrder.count(),
    'Reviews': await prisma.review.count(),
    'Wishlist Items': await prisma.wishlistItem.count(),
    'Cart Items': await prisma.cartItem.count(),
    'Flash Sales': await prisma.flashSale.count(),
    'Business Expenses': await prisma.businessExpense.count(),
    'Inventory Txns': await prisma.inventoryTransaction.count(),
    'Customer Events': await prisma.customerEvent.count(),
    'Pages': await prisma.page.count(),
    'Login Attempts': await prisma.loginAttempt.count(),
  };
  for (const [name, count] of Object.entries(counts)) {
    console.log(`  ${name}: ${count}`);
  }

  console.log('\nDemo data seeded successfully!');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Seed error:', e);
  prisma.$disconnect();
  process.exit(1);
});
