import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as nodemailer from 'nodemailer';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import { currentRequestTenantId } from '../tenant/request-context';
import { resolveDefaultTenantId } from '../tenant/default-tenant';

interface EmailOptions {
  to: string;
  subject: string;
  template: string;
  context: Record<string, any>;
  /** Tenant whose branding (site_name / business_domain) to use. Preferred. */
  tenantId?: string | null;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private layoutTemplate: handlebars.TemplateDelegate | null = null;
  private templates: Map<string, handlebars.TemplateDelegate> = new Map();
  private mailFrom: string;
  private isConfigured = false;
  private storeUrl: string;
  private adminUrl: string;
  private readonly brandingCache = new Map<
    string,
    { value: { businessName: string; domain: string }; expires: number }
  >();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const host = this.configService.get<string>('SMTP_HOST', '');
    const port = this.configService.get<number>('SMTP_PORT', 587);
    const user = this.configService.get<string>('SMTP_USER', '');
    const pass = this.configService.get<string>('SMTP_PASS', '');
    this.mailFrom = this.configService.get<string>(
      'SMTP_FROM',
      'noreply@narofashion.co.tz',
    );
    this.storeUrl = this.configService.get<string>(
      'STOREFRONT_URL',
      'http://localhost:3000',
    );
    this.adminUrl = this.configService.get<string>(
      'ADMIN_URL',
      'http://localhost:3001',
    );

    if (host && user && pass) {
      try {
        this.transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
        });
        this.isConfigured = true;
        this.logger.log(`Email service configured with SMTP host: ${host}`);
      } catch (error) {
        this.logger.warn(
          `Failed to create SMTP transporter: ${error instanceof Error ? error.message : error}`,
        );
      }
    } else {
      this.logger.warn(
        'Email service not configured — SMTP_HOST, SMTP_USER, or SMTP_PASS missing. Emails will be logged only.',
      );
    }

    this.loadTemplates();
  }

  private loadTemplates() {
    try {
      const templatesDir = path.join(__dirname, 'templates');

      // Load layout template
      const layoutPath = path.join(templatesDir, 'layout.hbs');
      if (fs.existsSync(layoutPath)) {
        const layoutSource = fs.readFileSync(layoutPath, 'utf8');
        this.layoutTemplate = handlebars.compile(layoutSource);
        this.logger.log('Loaded email layout template');
      } else {
        this.logger.warn(`Layout template not found at ${layoutPath}`);
      }

      // Load all .hbs templates (except layout)
      const templateFiles = [
        'order-confirmation',
        'rental-reminder',
        'overdue-rental',
        'id-verification',
        'password-reset',
        'admin-prep-reminder',
        'newsletter',
        'newsletter-new-arrivals',
        'contact-acknowledgement',
        'contact-reply',
        'abandoned-cart',
      ];

      for (const name of templateFiles) {
        const filePath = path.join(templatesDir, `${name}.hbs`);
        if (fs.existsSync(filePath)) {
          const source = fs.readFileSync(filePath, 'utf8');
          this.templates.set(name, handlebars.compile(source));
        } else {
          this.logger.warn(`Template not found: ${filePath}`);
        }
      }

      this.logger.log(`Loaded ${this.templates.size} email templates`);
    } catch (error) {
      this.logger.error(
        `Failed to load email templates: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Which tenant's branding to use, in order:
   *   1. the explicit `tenantId` the caller passed (preferred — REQUIRED for
   *      cron/background paths that iterate rows across tenants)
   *   2. the tenant of the in-flight HTTP request (AsyncLocalStorage — see
   *      tenant/request-context.ts; works without making this singleton
   *      request-scoped)
   *   3. the deployment's default tenant (DEFAULT_TENANT_SLUG / sole tenant)
   *   4. null → hard-coded defaults
   *
   * Previously every email did an UNSCOPED `findFirst({ key: 'site_name' })`,
   * so tenant B's customers received tenant A's name/domain.
   */
  async resolveTenantId(tenantId?: string | null): Promise<string | null> {
    if (tenantId) return tenantId;
    const fromRequest = currentRequestTenantId();
    if (fromRequest) return fromRequest;
    return resolveDefaultTenantId(this.prisma);
  }

  /** Tenant-scoped business name + domain (60s cache per tenant). */
  async getBranding(tenantId?: string | null): Promise<{ businessName: string; domain: string }> {
    const resolved = await this.resolveTenantId(tenantId);
    const fallback = { businessName: 'Naro Fashion', domain: 'narofashion.co.tz' };
    if (!resolved) return fallback;

    const hit = this.brandingCache.get(resolved);
    if (hit && hit.expires > Date.now()) return hit.value;

    try {
      const rows = await this.prisma.siteSetting.findMany({
        where: { tenantId: resolved, key: { in: ['site_name', 'business_domain'] } },
        select: { key: true, value: true },
      });
      const map = new Map(rows.map((r) => [r.key, r.value]));
      const value = {
        businessName: map.get('site_name') || fallback.businessName,
        domain: map.get('business_domain') || fallback.domain,
      };
      this.brandingCache.set(resolved, { value, expires: Date.now() + 60_000 });
      return value;
    } catch {
      return fallback;
    }
  }

  /**
   * Send an email using a Handlebars template wrapped in the layout.
   * Never throws — failures are caught and logged.
   *
   * Pass `tenantId` whenever known (see resolveTenantId for the fallback chain).
   */
  async send(options: EmailOptions): Promise<{ sent: boolean; channel: string; error?: string }> {
    const { to, subject, template, context } = options;

    this.logger.log(`[EMAIL] Preparing "${subject}" to ${to} (template: ${template})`);

    // Render the body template
    const bodyTemplate = this.templates.get(template);
    if (!bodyTemplate) {
      this.logger.error(`[EMAIL] Template "${template}" not found`);
      return { sent: false, channel: 'error' };
    }

    const { businessName, domain } = await this.getBranding(options.tenantId);

    const enrichedContext = {
      ...context,
      businessName,
      domain,
      storeUrl: this.storeUrl,
      adminUrl: this.adminUrl,
      year: new Date().getFullYear(),
    };

    const bodyHtml = bodyTemplate(enrichedContext);

    // Wrap body in layout
    let html: string;
    if (this.layoutTemplate) {
      html = this.layoutTemplate({ ...enrichedContext, subject, body: bodyHtml });
    } else {
      html = bodyHtml;
    }

    if (!this.isConfigured || !this.transporter) {
      this.logger.warn(`[EMAIL] Not configured — email logged only. Subject: "${subject}" To: ${to}`);
      this.logger.debug(`[EMAIL] Body preview: ${bodyHtml.substring(0, 200)}...`);
      return { sent: false, channel: 'log' };
    }

    try {
      const info = await this.transporter.sendMail({
        from: `"${businessName}" <${this.mailFrom}>`,
        to,
        subject,
        html,
      });

      this.logger.log(`[EMAIL] Sent successfully to ${to}: messageId=${info.messageId}`);
      return { sent: true, channel: 'smtp' };
    } catch (error) {
      this.logger.error(
        `[EMAIL] Failed to send to ${to}: ${error instanceof Error ? error.message : error}`,
      );
      return { sent: false, channel: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }
}
