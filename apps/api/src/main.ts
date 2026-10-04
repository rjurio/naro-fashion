import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { requestContextMiddleware } from './tenant/request-context';
import { isSwaggerEnabled } from './health/swagger.util';

async function bootstrap() {
  // rawBody: true keeps the unparsed body on `req.rawBody` — payment webhook
  // signature verification (Selcom HMAC / ClickPesa checksum) depends on it.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Exactly one trusted proxy hop (nginx on the same box). Makes `req.ip`
  // the real client IP from X-Forwarded-For instead of 127.0.0.1 — required
  // for per-client rate limiting and audit IPs. Do NOT raise this above the
  // real number of proxies or clients can spoof their IP via the header.
  app.set('trust proxy', 1);

  // Must be first: binds the request to an AsyncLocalStorage so singleton
  // services (EmailService etc.) can read the current request's tenant.
  app.use(requestContextMiddleware);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(compression());
  app.use(cookieParser());

  // CORS allow-list. Both STOREFRONT_URL and ADMIN_URL support a
  // comma-separated list so we can allow both apex + www variants
  // (e.g. "https://narofashion.co.tz,https://www.narofashion.co.tz").
  // Without this, a browser on www fails CORS preflight because the
  // API only allow-listed the apex, and every fetch throws "Failed to
  // fetch" with no Access-Control-Allow-Origin header in the response.
  const splitOrigins = (raw: string | undefined, fallback: string) =>
    (raw || fallback)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  app.enableCors({
    origin: [
      ...splitOrigins(process.env.STOREFRONT_URL, 'http://localhost:3000'),
      ...splitOrigins(process.env.ADMIN_URL, 'http://localhost:3001'),
    ],
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger API Documentation (disabled in production unless ENABLE_SWAGGER=true)
  const swaggerEnabled = isSwaggerEnabled();
  if (swaggerEnabled) {
  const config = new DocumentBuilder()
    .setTitle('Naro Fashion API')
    .setDescription('REST API for Naro Fashion e-commerce platform — products, orders, rentals, payments, auth, and more.')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
    .addTag('auth', 'Authentication & user management')
    .addTag('products', 'Product catalog')
    .addTag('categories', 'Product categories')
    .addTag('cart', 'Shopping cart')
    .addTag('orders', 'Order management')
    .addTag('payments', 'Payment processing')
    .addTag('rentals', 'Gown & fashion rental system')
    .addTag('reviews', 'Product reviews & ratings')
    .addTag('flash-sales', 'Flash sales & promotions')
    .addTag('cms', 'Content management (banners, pages, settings)')
    .addTag('analytics', 'Dashboard analytics & reporting')
    .addTag('pos', 'Point of Sale')
    .addTag('inventory', 'Inventory management')
    .addTag('shipping', 'Shipping zones & rates')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Naro Fashion API Docs',
    customfavIcon: '/favicon.jpg',
  });
  }

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`Naro Fashion API running on http://localhost:${port}`);
  if (swaggerEnabled) {
    console.log(`Swagger docs available at http://localhost:${port}/api/docs`);
  }
}
bootstrap();
