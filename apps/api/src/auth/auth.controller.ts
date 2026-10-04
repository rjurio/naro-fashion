import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import {
  AuthService,
  GENERIC_LOGIN_ERROR,
  parseDurationMs,
  toPublicPrincipal,
} from './auth.service';
import {
  RegisterDto,
  PlatformLoginDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  Toggle2FADto,
  UpdateMeDto,
} from './dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';

// Fallback maxAge if the configured JWT expiration string is somehow unparseable
// (shouldn't happen — defaults are valid — but cookies need a number).
const FALLBACK_ACCESS_COOKIE_MS = 15 * 60 * 1000;
const FALLBACK_REFRESH_COOKIE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';

// Per-route rate limits (ThrottlerGuard is registered globally in app.module).
const ONE_MINUTE_MS = 60_000;

type Tokens = { accessToken: string; refreshToken: string; accessExpiresIn: string; refreshExpiresIn: string };

function setAuthCookies(res: Response, tokens: Tokens) {
  res.cookie('access_token', tokens.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: parseDurationMs(tokens.accessExpiresIn) ?? FALLBACK_ACCESS_COOKIE_MS,
  });

  res.cookie('refresh_token', tokens.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: parseDurationMs(tokens.refreshExpiresIn) ?? FALLBACK_REFRESH_COOKIE_MS,
    path: REFRESH_COOKIE_PATH,
  });
}

function loginMeta(req: Request) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: (req.headers?.['user-agent'] as string | undefined) ?? null,
  };
}

function bearerToken(req: Request): string | undefined {
  const h = req.headers?.authorization;
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.substring(7) : undefined;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    // req.tenantId is set (and cross-validated against any Bearer token) by
    // TenantInterceptor; fall back to the raw header. AuthService rejects a
    // missing / unknown / inactive tenant — no tenant-less customers.
    const tenantId = (req as any).tenantId ?? req.headers['x-tenant-id'];
    const user = await this.authService.register(dto, tenantId);
    return { message: 'Registration successful', user };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as {
      id: string;
      email: string;
      tenantId?: string;
      isAdmin?: boolean;
      isPlatformAdmin?: boolean;
      role?: string;
      tokenVersion?: number;
    };
    const tokens = await this.authService.generateTokens(user);
    setAuthCookies(res, tokens);

    return {
      message: 'Login successful',
      user: toPublicPrincipal(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: ONE_MINUTE_MS } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Body() body: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Accept the refresh token from either an httpOnly cookie (browser) OR
    // a JSON body field (the SPA's localStorage-based flow uses this path).
    const refreshToken = req.cookies?.refresh_token || body?.refreshToken;
    const tokens = await this.authService.refreshTokens(refreshToken);
    setAuthCookies(res, tokens);

    return {
      message: 'Tokens refreshed',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * Logout = server-side revocation + cookie clear. The caller's tokenVersion
   * is bumped so every outstanding access/refresh token (including copies in
   * localStorage on other devices) stops verifying.
   *
   * @Public() on purpose: the access token may already be expired. The
   * service verifies the presented access token's signature (expiry ignored)
   * or the refresh token to identify the principal; cookies are always cleared.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Body() body: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accessToken = req.cookies?.access_token || bearerToken(req);
    const refreshToken = req.cookies?.refresh_token || body?.refreshToken;
    try {
      await this.authService.revokeFromTokens(accessToken, refreshToken);
    } finally {
      res.clearCookie('access_token');
      res.clearCookie('refresh_token', { path: REFRESH_COOKIE_PATH });
    }
    return { message: 'Logged out' };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
  @Post('platform-login')
  @HttpCode(HttpStatus.OK)
  async platformLogin(
    @Body() body: PlatformLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const admin = await this.authService.validatePlatformAdmin(body.email, body.password, loginMeta(req));
    if (!admin) {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    const tokens = await this.authService.generateTokens(admin);
    setAuthCookies(res, tokens);

    return {
      message: 'Login successful',
      user: toPublicPrincipal(admin),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: { id: string; isAdmin?: boolean; isPlatformAdmin?: boolean }) {
    return this.authService.getProfile(user.id, user.isAdmin, user.isPlatformAdmin);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(
    @CurrentUser() user: { id: string; isAdmin?: boolean },
    @Body() data: UpdateMeDto,
  ) {
    return this.authService.updateProfile(user.id, data, user.isAdmin);
  }

  /**
   * Changes the caller's password and bumps tokenVersion (signing out every
   * other session). Fresh tokens for THIS session are returned + set as
   * cookies — clients storing tokens in local/sessionStorage must replace
   * them with the returned `accessToken` / `refreshToken`.
   */
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: { id: string; isAdmin?: boolean; isPlatformAdmin?: boolean },
    @Body() data: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.changePassword(user, data.currentPassword, data.newPassword);
    const tokens = await this.authService.generateTokens(result.principal);
    setAuthCookies(res, tokens);
    return {
      message: result.message,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('2fa')
  async toggle2FA(
    @CurrentUser() user: { id: string; isAdmin?: boolean; isPlatformAdmin?: boolean },
    @Body() data: Toggle2FADto,
  ) {
    return this.authService.toggle2FA(user, data.enabled, data.currentPassword);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: ONE_MINUTE_MS } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() body: ForgotPasswordDto, @Req() req: Request) {
    // Storefront sends X-Tenant-Id → tenant-scoped customer reset.
    // Admin app sends no tenant → admin reset.
    const tenantId = (req as any).tenantId ?? req.headers['x-tenant-id'];
    return this.authService.forgotPassword(body.email, tenantId);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }
}
