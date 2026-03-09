import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Naro Fashion database...');

  // Create Admin Users
  const adminPassword = await bcrypt.hash('admin123', 10);
  const superAdmin = await prisma.adminUser.upsert({
    where: { email: 'admin@narofashion.co.tz' },
    update: {},
    create: {
      email: 'admin@narofashion.co.tz',
      passwordHash: adminPassword,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
    },
  });
  console.log('Created admin user:', superAdmin.email);

  // Create Categories
  const womenCategory = await prisma.category.upsert({
    where: { slug: 'women' },
    update: {},
    create: {
      name: 'Women',
      nameSwahili: 'Wanawake',
      slug: 'women',
      description: 'Women\'s fashion and clothing',
      sortOrder: 1,
    },
  });

  const menCategory = await prisma.category.upsert({
    where: { slug: 'men' },
    update: {},
    create: {
      name: 'Men',
      nameSwahili: 'Wanaume',
      slug: 'men',
      description: 'Men\'s fashion and clothing',
      sortOrder: 2,
    },
  });

  const dressesCategory = await prisma.category.upsert({
    where: { slug: 'dresses' },
    update: {},
    create: {
      name: 'Dresses',
      nameSwahili: 'Mavazi',
      slug: 'dresses',
      description: 'Beautiful dresses for all occasions',
      parentId: womenCategory.id,
      sortOrder: 1,
    },
  });

  const gownsCategory = await prisma.category.upsert({
    where: { slug: 'gowns' },
    update: {},
    create: {
      name: 'Gowns',
      nameSwahili: 'Gauni',
      slug: 'gowns',
      description: 'Elegant gowns for rent and purchase',
      parentId: womenCategory.id,
      sortOrder: 2,
    },
  });

  const shirtsCategory = await prisma.category.upsert({
    where: { slug: 'shirts' },
    update: {},
    create: {
      name: 'Shirts',
      nameSwahili: 'Mashati',
      slug: 'shirts',
      description: 'Men\'s shirts and tops',
      parentId: menCategory.id,
      sortOrder: 1,
    },
  });

  const accessoriesCategory = await prisma.category.upsert({
    where: { slug: 'accessories' },
    update: {},
    create: {
      name: 'Accessories',
      nameSwahili: 'Vifaa',
      slug: 'accessories',
      description: 'Fashion accessories',
      sortOrder: 3,
    },
  });

  console.log('Created categories');

  // Create Products
  const elegantGown = await prisma.product.create({
    data: {
      name: 'Elegant Gold Evening Gown',
      nameSwahili: 'Gauni la Jioni la Dhahabu',
      slug: 'elegant-gold-evening-gown',
      description: 'A stunning gold evening gown perfect for weddings, galas, and special occasions. Features intricate beadwork and a flowing silhouette.',
      categoryId: gownsCategory.id,
      availabilityMode: 'BOTH',
      basePrice: 450000,
      rentalPricePerDay: 35000,
      rentalDepositAmount: 100000,
      rentalDownPaymentPct: 25,
      minRentalDays: 1,
      maxRentalDays: 7,
      isFeatured: true,
      variants: {
        create: [
          { name: 'Gold / Small', sku: 'GOWN-GOLD-S', size: 'S', color: 'Gold', colorHex: '#D4AF37', price: 450000, stock: 3 },
          { name: 'Gold / Medium', sku: 'GOWN-GOLD-M', size: 'M', color: 'Gold', colorHex: '#D4AF37', price: 450000, stock: 5 },
          { name: 'Gold / Large', sku: 'GOWN-GOLD-L', size: 'L', color: 'Gold', colorHex: '#D4AF37', price: 450000, stock: 4 },
        ],
      },
      images: {
        create: [
          { url: '/images/products/gown-gold-1.jpg', altText: 'Gold Evening Gown Front', isPrimary: true, sortOrder: 0 },
          { url: '/images/products/gown-gold-2.jpg', altText: 'Gold Evening Gown Back', sortOrder: 1 },
        ],
      },
    },
  });

  const pinkDress = await prisma.product.create({
    data: {
      name: 'Pink Cocktail Dress',
      nameSwahili: 'Gauni la Cocktail ya Pink',
      slug: 'pink-cocktail-dress',
      description: 'A chic pink cocktail dress with modern cut and comfortable fit. Perfect for parties and social events.',
      categoryId: dressesCategory.id,
      availabilityMode: 'PURCHASE_ONLY',
      basePrice: 185000,
      isFeatured: true,
      variants: {
        create: [
          { name: 'Pink / XS', sku: 'DRESS-PINK-XS', size: 'XS', color: 'Pink', colorHex: '#E91E8C', price: 185000, stock: 8 },
          { name: 'Pink / S', sku: 'DRESS-PINK-S', size: 'S', color: 'Pink', colorHex: '#E91E8C', price: 185000, stock: 12 },
          { name: 'Pink / M', sku: 'DRESS-PINK-M', size: 'M', color: 'Pink', colorHex: '#E91E8C', price: 185000, stock: 10 },
          { name: 'Pink / L', sku: 'DRESS-PINK-L', size: 'L', color: 'Pink', colorHex: '#E91E8C', price: 185000, stock: 6 },
        ],
      },
      images: {
        create: [
          { url: '/images/products/dress-pink-1.jpg', altText: 'Pink Cocktail Dress', isPrimary: true, sortOrder: 0 },
        ],
      },
    },
  });

  const blackSuit = await prisma.product.create({
    data: {
      name: 'Classic Black Suit',
      nameSwahili: 'Suti Nyeusi ya Kawaida',
      slug: 'classic-black-suit',
      description: 'A timeless classic black suit crafted with premium fabric. Suitable for business and formal occasions.',
      categoryId: menCategory.id,
      availabilityMode: 'BOTH',
      basePrice: 350000,
      rentalPricePerDay: 25000,
      rentalDepositAmount: 80000,
      rentalDownPaymentPct: 25,
      minRentalDays: 1,
      maxRentalDays: 5,
      isFeatured: true,
      variants: {
        create: [
          { name: 'Black / 38', sku: 'SUIT-BLK-38', size: '38', color: 'Black', colorHex: '#1A1A1A', price: 350000, stock: 4 },
          { name: 'Black / 40', sku: 'SUIT-BLK-40', size: '40', color: 'Black', colorHex: '#1A1A1A', price: 350000, stock: 6 },
          { name: 'Black / 42', sku: 'SUIT-BLK-42', size: '42', color: 'Black', colorHex: '#1A1A1A', price: 350000, stock: 5 },
        ],
      },
      images: {
        create: [
          { url: '/images/products/suit-black-1.jpg', altText: 'Classic Black Suit', isPrimary: true, sortOrder: 0 },
        ],
      },
    },
  });

  const whiteShirt = await prisma.product.create({
    data: {
      name: 'Premium White Dress Shirt',
      nameSwahili: 'Shati Nyeupe ya Kifahari',
      slug: 'premium-white-dress-shirt',
      description: 'A premium white dress shirt made from Egyptian cotton. Slim fit with French cuffs.',
      categoryId: shirtsCategory.id,
      availabilityMode: 'PURCHASE_ONLY',
      basePrice: 65000,
      variants: {
        create: [
          { name: 'White / S', sku: 'SHIRT-WHT-S', size: 'S', color: 'White', colorHex: '#FFFFFF', price: 65000, stock: 20 },
          { name: 'White / M', sku: 'SHIRT-WHT-M', size: 'M', color: 'White', colorHex: '#FFFFFF', price: 65000, stock: 25 },
          { name: 'White / L', sku: 'SHIRT-WHT-L', size: 'L', color: 'White', colorHex: '#FFFFFF', price: 65000, stock: 18 },
          { name: 'White / XL', sku: 'SHIRT-WHT-XL', size: 'XL', color: 'White', colorHex: '#FFFFFF', price: 65000, stock: 15 },
        ],
      },
      images: {
        create: [
          { url: '/images/products/shirt-white-1.jpg', altText: 'White Dress Shirt', isPrimary: true, sortOrder: 0 },
        ],
      },
    },
  });

  const weddingGown = await prisma.product.create({
    data: {
      name: 'Royal Wedding Gown',
      nameSwahili: 'Gauni la Harusi la Kifalme',
      slug: 'royal-wedding-gown',
      description: 'A breathtaking royal wedding gown with lace detailing, pearl embellishments, and cathedral-length train.',
      categoryId: gownsCategory.id,
      availabilityMode: 'RENTAL_ONLY',
      basePrice: 1200000,
      rentalPricePerDay: 80000,
      rentalDepositAmount: 300000,
      rentalDownPaymentPct: 25,
      minRentalDays: 2,
      maxRentalDays: 5,
      isFeatured: true,
      variants: {
        create: [
          { name: 'White / S', sku: 'WGOWN-WHT-S', size: 'S', color: 'White', colorHex: '#FFFDF7', price: 1200000, stock: 2 },
          { name: 'White / M', sku: 'WGOWN-WHT-M', size: 'M', color: 'White', colorHex: '#FFFDF7', price: 1200000, stock: 3 },
          { name: 'White / L', sku: 'WGOWN-WHT-L', size: 'L', color: 'White', colorHex: '#FFFDF7', price: 1200000, stock: 2 },
        ],
      },
      images: {
        create: [
          { url: '/images/products/wedding-gown-1.jpg', altText: 'Royal Wedding Gown', isPrimary: true, sortOrder: 0 },
        ],
      },
    },
  });

  console.log('Created products');

  // Create Shipping Zones
  await prisma.shippingZone.create({
    data: {
      name: 'Dar es Salaam',
      description: 'Dar es Salaam city and suburbs',
      regions: ['Dar es Salaam'],
      rates: {
        create: [
          { name: 'Standard Delivery', price: 3000, estimatedDays: 2 },
          { name: 'Express Delivery', price: 8000, estimatedDays: 1 },
        ],
      },
    },
  });

  await prisma.shippingZone.create({
    data: {
      name: 'Major Cities',
      description: 'Arusha, Mwanza, Dodoma, Mbeya, Zanzibar',
      regions: ['Arusha', 'Mwanza', 'Dodoma', 'Mbeya', 'Zanzibar'],
      rates: {
        create: [
          { name: 'Standard Delivery', price: 8000, estimatedDays: 4 },
          { name: 'Express Delivery', price: 15000, estimatedDays: 2 },
        ],
      },
    },
  });

  await prisma.shippingZone.create({
    data: {
      name: 'Other Regions',
      description: 'All other regions in Tanzania',
      regions: ['Other'],
      rates: {
        create: [
          { name: 'Standard Delivery', price: 12000, estimatedDays: 7 },
        ],
      },
    },
  });

  console.log('Created shipping zones');

  // Create Pickup Points
  await prisma.pickupPoint.create({
    data: {
      name: 'Naro Fashion Kariakoo',
      address: 'Kariakoo Market, Msimbazi Street',
      city: 'Dar es Salaam',
      region: 'Dar es Salaam',
      phone: '+255712000001',
    },
  });

  await prisma.pickupPoint.create({
    data: {
      name: 'Naro Fashion Mlimani City',
      address: 'Mlimani City Mall, Sam Nujoma Road',
      city: 'Dar es Salaam',
      region: 'Dar es Salaam',
      phone: '+255712000002',
    },
  });

  console.log('Created pickup points');

  // Create Rental Policy
  await prisma.rentalPolicy.create({
    data: {
      bufferDaysBetweenRentals: 7,
      defaultDownPaymentPct: 25,
      lateFeePerDay: 10000,
      maxRentalDurationDays: 30,
      advancePreparationReminderDays: 8,
    },
  });

  console.log('Created rental policy');

  // Create Rental Checklist Templates

  // Standard Gown Dispatch Template
  const dispatchTemplate = await prisma.rentalChecklistTemplate.create({
    data: {
      name: 'Standard Gown Dispatch',
      description: 'Comprehensive checklist for dispatching gowns and formal wear to customers',
      isDefault: true,
      items: {
        create: [
          { label: 'Item has been professionally dry cleaned / laundered', labelSwahili: 'Bidhaa imefuliwa kitaalamu', itemType: 'DISPATCH', sortOrder: 1 },
          { label: 'Item has been ironed and pressed properly', labelSwahili: 'Bidhaa imepigwa pasi vizuri', itemType: 'DISPATCH', sortOrder: 2 },
          { label: 'No visible stains, tears, or damage', labelSwahili: 'Hakuna madoa, michubuko au uharibifu unaoonekana', itemType: 'DISPATCH', sortOrder: 3 },
          { label: 'All buttons, zippers, and fasteners are functional', labelSwahili: 'Vifungo vyote, zipa na vifunga vinafanya kazi', itemType: 'DISPATCH', sortOrder: 4 },
          { label: 'Veil included and in good condition', labelSwahili: 'Shela imejumuishwa na iko katika hali nzuri', itemType: 'DISPATCH', sortOrder: 5 },
          { label: 'Flower accessories / bouquet included', labelSwahili: 'Mapambo ya maua / shada la maua limejumuishwa', itemType: 'DISPATCH', sortOrder: 6 },
          { label: 'Petticoat / underskirt included', labelSwahili: 'Petikoti / sketi ya ndani imejumuishwa', itemType: 'DISPATCH', sortOrder: 7 },
          { label: 'Belt / sash / waist accessory included', labelSwahili: 'Mkanda / kitambaa cha kiuno kimejumuishwa', itemType: 'DISPATCH', sortOrder: 8 },
          { label: 'Crown / tiara / headpiece included (if applicable)', labelSwahili: 'Taji / tiara / kipambo cha kichwa kimejumuishwa (ikihitajika)', itemType: 'DISPATCH', sortOrder: 9 },
          { label: 'Jewellery set included (necklace, earrings, bracelet)', labelSwahili: 'Seti ya vito imejumuishwa (mkufu, herini, bangili)', itemType: 'DISPATCH', sortOrder: 10 },
          { label: 'Shoes / matching footwear included', labelSwahili: 'Viatu vinavyolingana vimejumuishwa', itemType: 'DISPATCH', sortOrder: 11 },
          { label: 'Garment bag / protective packaging provided', labelSwahili: 'Mfuko wa nguo / ufungashaji wa kinga umetolewa', itemType: 'DISPATCH', sortOrder: 12 },
          { label: 'Photos taken of item condition before dispatch', labelSwahili: 'Picha zimepigwa za hali ya bidhaa kabla ya kutuma', itemType: 'DISPATCH', sortOrder: 13 },
          { label: 'Customer received and signed for item', labelSwahili: 'Mteja amepokea na kusaini bidhaa', itemType: 'DISPATCH', sortOrder: 14 },
        ],
      },
    },
  });

  // Standard Gown Return Template
  const returnTemplate = await prisma.rentalChecklistTemplate.create({
    data: {
      name: 'Standard Gown Return',
      description: 'Comprehensive checklist for receiving returned gowns and formal wear',
      isDefault: true,
      items: {
        create: [
          { label: 'Item returned on or before due date', labelSwahili: 'Bidhaa imerudishwa kwa wakati au kabla ya tarehe ya mwisho', itemType: 'RETURN', sortOrder: 1 },
          { label: 'No new stains, tears, or damage', labelSwahili: 'Hakuna madoa mapya, michubuko au uharibifu', itemType: 'RETURN', sortOrder: 2 },
          { label: 'All accessories returned (veil, flowers, belt, crown, jewellery)', labelSwahili: 'Mapambo yote yamerudishwa (shela, maua, mkanda, taji, vito)', itemType: 'RETURN', sortOrder: 3 },
          { label: 'Shoes returned in same condition', labelSwahili: 'Viatu vimerudishwa katika hali ile ile', itemType: 'RETURN', sortOrder: 4 },
          { label: 'Petticoat / underskirt returned', labelSwahili: 'Petikoti / sketi ya ndani imerudishwa', itemType: 'RETURN', sortOrder: 5 },
          { label: 'All zippers, buttons, and fasteners intact', labelSwahili: 'Zipa, vifungo na vifunga vyote viko sawa', itemType: 'RETURN', sortOrder: 6 },
          { label: 'Garment bag / packaging returned', labelSwahili: 'Mfuko wa nguo / ufungashaji umerudishwa', itemType: 'RETURN', sortOrder: 7 },
          { label: 'Photos taken of item condition upon return', labelSwahili: 'Picha zimepigwa za hali ya bidhaa ikirudishwa', itemType: 'RETURN', sortOrder: 8 },
          { label: 'Item inspected and condition noted', labelSwahili: 'Bidhaa imekaguliwa na hali imeandikwa', itemType: 'RETURN', sortOrder: 9 },
          { label: 'Damage assessment completed (if any)', labelSwahili: 'Tathmini ya uharibifu imekamilika (ikipo)', itemType: 'RETURN', sortOrder: 10 },
          { label: 'Cleaning/repair needed noted', labelSwahili: 'Usafishaji/ukarabati unaohitajika umeandikwa', itemType: 'RETURN', sortOrder: 11 },
          { label: 'Deposit refund amount determined', labelSwahili: 'Kiasi cha kurudisha amana kimeamuliwa', itemType: 'RETURN', sortOrder: 12 },
        ],
      },
    },
  });

  // Suit Rental Dispatch Template
  const suitDispatchTemplate = await prisma.rentalChecklistTemplate.create({
    data: {
      name: 'Suit Rental Dispatch',
      description: 'Checklist for dispatching suits and formal menswear to customers',
      isDefault: false,
      items: {
        create: [
          { label: 'Suit jacket cleaned and pressed', labelSwahili: 'Jaketi la suti limesafishwa na kupigwa pasi', itemType: 'DISPATCH', sortOrder: 1 },
          { label: 'Trousers cleaned and pressed', labelSwahili: 'Suruali imesafishwa na kupigwa pasi', itemType: 'DISPATCH', sortOrder: 2 },
          { label: 'Dress shirt included and ironed', labelSwahili: 'Shati la rasmi limejumuishwa na kupigwa pasi', itemType: 'DISPATCH', sortOrder: 3 },
          { label: 'Tie / bow tie included', labelSwahili: 'Tai / tai ya kipepeo imejumuishwa', itemType: 'DISPATCH', sortOrder: 4 },
          { label: 'Cufflinks and pocket square included', labelSwahili: 'Vifungo vya mikono na kitambaa cha mfukoni vimejumuishwa', itemType: 'DISPATCH', sortOrder: 5 },
          { label: 'Belt included', labelSwahili: 'Mkanda umejumuishwa', itemType: 'DISPATCH', sortOrder: 6 },
          { label: 'Shoes polished and included', labelSwahili: 'Viatu vimeng\'arishwa na kujumuishwa', itemType: 'DISPATCH', sortOrder: 7 },
          { label: 'Garment bag provided', labelSwahili: 'Mfuko wa nguo umetolewa', itemType: 'DISPATCH', sortOrder: 8 },
          { label: 'Photos taken of condition', labelSwahili: 'Picha zimepigwa za hali ya bidhaa', itemType: 'DISPATCH', sortOrder: 9 },
        ],
      },
    },
  });

  // Suit Rental Return Template
  const suitReturnTemplate = await prisma.rentalChecklistTemplate.create({
    data: {
      name: 'Suit Rental Return',
      description: 'Checklist for receiving returned suits and formal menswear',
      isDefault: false,
      items: {
        create: [
          { label: 'Item returned on or before due date', labelSwahili: 'Bidhaa imerudishwa kwa wakati au kabla ya tarehe ya mwisho', itemType: 'RETURN', sortOrder: 1 },
          { label: 'Suit jacket returned with no damage', labelSwahili: 'Jaketi la suti limerudishwa bila uharibifu', itemType: 'RETURN', sortOrder: 2 },
          { label: 'Trousers returned in good condition', labelSwahili: 'Suruali imerudishwa katika hali nzuri', itemType: 'RETURN', sortOrder: 3 },
          { label: 'Dress shirt returned', labelSwahili: 'Shati la rasmi limerudishwa', itemType: 'RETURN', sortOrder: 4 },
          { label: 'Tie / bow tie returned', labelSwahili: 'Tai / tai ya kipepeo imerudishwa', itemType: 'RETURN', sortOrder: 5 },
          { label: 'Cufflinks and pocket square returned', labelSwahili: 'Vifungo vya mikono na kitambaa cha mfukoni vimerudishwa', itemType: 'RETURN', sortOrder: 6 },
          { label: 'Belt returned', labelSwahili: 'Mkanda umerudishwa', itemType: 'RETURN', sortOrder: 7 },
          { label: 'Shoes returned in same condition', labelSwahili: 'Viatu vimerudishwa katika hali ile ile', itemType: 'RETURN', sortOrder: 8 },
          { label: 'Garment bag returned', labelSwahili: 'Mfuko wa nguo umerudishwa', itemType: 'RETURN', sortOrder: 9 },
          { label: 'Photos taken of condition upon return', labelSwahili: 'Picha zimepigwa za hali ya bidhaa ikirudishwa', itemType: 'RETURN', sortOrder: 10 },
          { label: 'Damage assessment completed (if any)', labelSwahili: 'Tathmini ya uharibifu imekamilika (ikipo)', itemType: 'RETURN', sortOrder: 11 },
          { label: 'Deposit refund amount determined', labelSwahili: 'Kiasi cha kurudisha amana kimeamuliwa', itemType: 'RETURN', sortOrder: 12 },
        ],
      },
    },
  });

  console.log('Created rental checklist templates');

  // Create CMS content
  await prisma.banner.createMany({
    data: [
      {
        title: 'New Collection 2026',
        titleSwahili: 'Mkusanyiko Mpya 2026',
        subtitle: 'Discover the latest trends in fashion',
        subtitleSwahili: 'Gundua mitindo ya hivi karibuni',
        imageUrl: '/images/banners/hero-1.jpg',
        linkUrl: '/products',
        sortOrder: 1,
      },
      {
        title: 'Rent a Gown',
        titleSwahili: 'Kodi Gauni',
        subtitle: 'Premium gowns available for rent at affordable prices',
        subtitleSwahili: 'Gauni za kifahari zinapatikana kwa bei nafuu',
        imageUrl: '/images/banners/hero-2.jpg',
        linkUrl: '/rentals',
        sortOrder: 2,
      },
    ],
  });

  // Create Site Settings
  await prisma.siteSetting.createMany({
    data: [
      { key: 'site_name', value: 'Naro Fashion', type: 'string' },
      { key: 'site_description', value: 'Premium Fashion & Clothing in Tanzania', type: 'string' },
      { key: 'contact_email', value: 'info@narofashion.co.tz', type: 'string' },
      { key: 'contact_phone', value: '+255712000000', type: 'string' },
      { key: 'currency', value: 'TZS', type: 'string' },
      { key: 'default_theme', value: 'standard', type: 'string' },
    ],
  });

  console.log('Created CMS content and site settings');
  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
