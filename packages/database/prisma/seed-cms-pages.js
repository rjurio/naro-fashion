const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding CMS pages...');

  // Terms of Service
  await prisma.page.upsert({
    where: { slug: 'terms' },
    update: {},
    create: {
      title: 'Terms of Service',
      titleSwahili: 'Masharti ya Huduma',
      slug: 'terms',
      content: `<h2>1. General Terms</h2>
<p>By using Naro Fashion's website and services, you agree to these terms of service. We reserve the right to modify these terms at any time. Continued use of our services after changes constitutes acceptance of the updated terms.</p>

<h2>2. Orders & Purchases</h2>
<p>All orders are subject to availability and confirmation. Prices are listed in Tanzanian Shillings (TZS) and may change without notice. We reserve the right to refuse or cancel orders at our discretion.</p>

<h2>3. Rental Terms</h2>
<p>Rental items must be returned by the agreed return date. Late returns incur a daily fee. Customers are responsible for any damage beyond normal wear. A damage deposit is required and may be partially or fully withheld based on the item's condition upon return. National ID verification is mandatory for all rental transactions.</p>

<h2>4. Payments & Refunds</h2>
<p>Payments must be made through our approved payment methods. Refunds for purchases are processed within 5-10 business days. Rental down payments are non-refundable if cancelled within 48 hours of the rental start date. Damage deposits are refunded after successful inspection of returned items.</p>

<h2>5. Account Responsibility</h2>
<p>You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. Notify us immediately of any unauthorized use.</p>

<h2>6. Intellectual Property</h2>
<p>All content on this website, including text, images, logos, and designs, is the property of Naro Fashion and is protected by copyright laws. Unauthorized use is prohibited.</p>

<h2>7. Limitation of Liability</h2>
<p>Naro Fashion shall not be liable for any indirect, incidental, or consequential damages arising from the use of our services. Our total liability shall not exceed the amount paid for the specific product or service in question.</p>

<h2>8. Governing Law</h2>
<p>These terms are governed by the laws of the United Republic of Tanzania. Any disputes shall be resolved through the courts of Tanzania.</p>`,
      contentSwahili: `<h2>1. Masharti ya Jumla</h2>
<p>Kwa kutumia tovuti na huduma za Naro Fashion, unakubali masharti haya ya huduma. Tunajihifadhi haki ya kubadilisha masharti haya wakati wowote. Kuendelea kutumia huduma zetu baada ya mabadiliko kunamaanisha kukubali masharti yaliyosasishwa.</p>

<h2>2. Oda na Ununuzi</h2>
<p>Oda zote zinategemea upatikanaji na uthibitisho. Bei zimeorodheshwa kwa Shilingi za Tanzania (TZS) na zinaweza kubadilika bila taarifa. Tunajihifadhi haki ya kukataa au kufuta oda kwa hiari yetu.</p>

<h2>3. Masharti ya Kukodisha</h2>
<p>Vitu vilivyokodishwa lazima virudishwe kufikia tarehe iliyokubaliwa. Urudishaji wa kuchelewa unalipishwa ada ya kila siku. Wateja wanawajibika kwa uharibifu wowote zaidi ya matumizi ya kawaida. Amana ya uharibifu inahitajika na inaweza kushikiliwa kwa sehemu au yote kulingana na hali ya kitu kirejesho. Uthibitisho wa kitambulisho cha taifa ni wa lazima kwa miamala yote ya kukodisha.</p>

<h2>4. Malipo na Marejesho</h2>
<p>Malipo lazima yafanywe kupitia njia zetu zilizoidhinishwa za malipo. Marejesho ya ununuzi yanashughulikiwa ndani ya siku 5-10 za kazi. Malipo ya awali ya kukodisha hayarejeshwi ikiwa yamefutwa ndani ya masaa 48 ya tarehe ya kuanza kukodisha. Amana za uharibifu zinarejeshwa baada ya ukaguzi wa mafanikio wa vitu vilivyorudishwa.</p>

<h2>5. Wajibu wa Akaunti</h2>
<p>Una wajibu wa kudumisha usiri wa taarifa za akaunti yako na kwa shughuli zote zinazotokea chini ya akaunti yako. Tuarifu mara moja kuhusu matumizi yoyote yasiyo halali.</p>

<h2>6. Miliki ya Kiakili</h2>
<p>Maudhui yote kwenye tovuti hii, ikiwa ni pamoja na maandishi, picha, alama za biashara, na muundo, ni mali ya Naro Fashion na yanalindwa na sheria za hakimiliki. Matumizi yasiyo halali yamekatazwa.</p>

<h2>7. Kikomo cha Dhima</h2>
<p>Naro Fashion haitawajibika kwa uharibifu wowote usio wa moja kwa moja, wa bahati mbaya, au unaotokana na matumizi ya huduma zetu.</p>

<h2>8. Sheria Inayotawala</h2>
<p>Masharti haya yanatawaliwa na sheria za Jamhuri ya Muungano wa Tanzania.</p>`,
      isPublished: true,
    },
  });
  console.log('Created/updated Terms of Service page');

  // Privacy Policy
  await prisma.page.upsert({
    where: { slug: 'privacy' },
    update: {},
    create: {
      title: 'Privacy Policy',
      titleSwahili: 'Sera ya Faragha',
      slug: 'privacy',
      content: `<h2>1. Information We Collect</h2>
<p>We collect information you provide when creating an account, placing orders, or contacting us. This includes your name, email, phone number, shipping addresses, and payment information. For rental services, we also collect national ID images for verification purposes.</p>

<h2>2. How We Use Your Information</h2>
<p>Your information is used to process orders, manage rentals, communicate about your transactions, improve our services, and send promotional offers (with your consent). We never sell your personal information to third parties.</p>

<h2>3. Information Sharing</h2>
<p>We share your information only with trusted partners necessary for service delivery: payment processors, shipping providers, and cloud service providers. All partners are bound by data protection agreements.</p>

<h2>4. Data Security</h2>
<p>We implement industry-standard security measures including encryption, secure servers, and access controls to protect your personal data. National ID images are encrypted at rest and access is restricted to authorized personnel only.</p>

<h2>5. Cookies & Tracking</h2>
<p>We use cookies and similar technologies to improve your browsing experience, remember your preferences, and analyze website traffic. You can control cookie settings through your browser preferences.</p>

<h2>6. Your Rights</h2>
<p>You have the right to access, correct, or delete your personal information at any time. You can also opt out of promotional communications by clicking the unsubscribe link in our emails or updating your account settings.</p>

<h2>7. Data Retention</h2>
<p>We retain your personal information for as long as your account is active or as needed to provide services. You may request account deletion at any time by contacting our support team.</p>

<h2>8. Contact Us</h2>
<p>For questions about this privacy policy or your personal data, contact us at info@narofashion.co.tz or visit our store in Dar es Salaam, Tanzania.</p>`,
      contentSwahili: `<h2>1. Taarifa Tunazokusanya</h2>
<p>Tunakusanya taarifa unazotoa unapotengeneza akaunti, kuweka oda, au kuwasiliana nasi. Hii inajumuisha jina lako, barua pepe, nambari ya simu, anwani za usafirishaji, na taarifa za malipo. Kwa huduma za kukodisha, pia tunakusanya picha za kitambulisho cha taifa kwa uthibitisho.</p>

<h2>2. Jinsi Tunavyotumia Taarifa Zako</h2>
<p>Taarifa zako zinatumika kushughulikia oda, kusimamia kukodisha, kuwasiliana kuhusu miamala yako, kuboresha huduma zetu, na kutuma matoleo ya matangazo (kwa idhini yako). Hatuwahi kuuza taarifa zako binafsi kwa wahusika wengine.</p>

<h2>3. Kushiriki Taarifa</h2>
<p>Tunashiriki taarifa zako tu na washirika wa kuaminika wanaohitajika kwa utoaji wa huduma: wasindikaji wa malipo, watoa huduma za usafirishaji, na watoa huduma za wingu. Washirika wote wanafungwa na makubaliano ya ulinzi wa data.</p>

<h2>4. Usalama wa Data</h2>
<p>Tunatekeleza hatua za usalama za kiwango cha tasnia ikiwa ni pamoja na usimbaji fiche, seva salama, na udhibiti wa ufikiaji ili kulinda data yako binafsi. Picha za kitambulisho cha taifa zimesimbwa kwa fiche wakati wa kuhifadhiwa na ufikiaji umezuiliwa kwa wafanyakazi walioidhinishwa pekee.</p>

<h2>5. Kuki na Ufuatiliaji</h2>
<p>Tunatumia kuki na teknolojia zinazofanana kuboresha uzoefu wako wa kuvinjari, kukumbuka mapendeleo yako, na kuchambua trafiki ya tovuti.</p>

<h2>6. Haki Zako</h2>
<p>Una haki ya kufikia, kusahihisha, au kufuta taarifa zako binafsi wakati wowote. Unaweza pia kujiondoa kutoka mawasiliano ya matangazo kwa kubofya kiungo cha kujiondoa katika barua pepe zetu au kusasisha mipangilio ya akaunti yako.</p>

<h2>7. Uhifadhi wa Data</h2>
<p>Tunahifadhi taarifa zako binafsi mradi akaunti yako inaendelea kuwa hai au inavyohitajika kutoa huduma. Unaweza kuomba kufutwa kwa akaunti wakati wowote kwa kuwasiliana na timu yetu ya msaada.</p>

<h2>8. Wasiliana Nasi</h2>
<p>Kwa maswali kuhusu sera hii ya faragha au data yako binafsi, wasiliana nasi kwa info@narofashion.co.tz au tembelea duka letu jijini Dar es Salaam, Tanzania.</p>`,
      isPublished: true,
    },
  });
  console.log('Created/updated Privacy Policy page');

  // Also seed WhatsApp number in site settings
  await prisma.siteSetting.upsert({
    where: { key: 'whatsapp_number' },
    update: {},
    create: {
      key: 'whatsapp_number',
      value: '+255759047287',
    },
  });
  console.log('Created/updated WhatsApp number setting');

  console.log('CMS pages seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
