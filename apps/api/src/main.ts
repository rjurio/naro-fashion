import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(compression());
  app.use(cookieParser());

  app.enableCors({
    origin: [
      process.env.STOREFRONT_URL || 'http://localhost:3000',
      process.env.ADMIN_URL || 'http://localhost:3001',
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

  // Swagger API Documentation
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

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`Naro Fashion API running on http://localhost:${port}`);
  console.log(`Swagger docs available at http://localhost:${port}/api/docs`);
}
bootstrap();
