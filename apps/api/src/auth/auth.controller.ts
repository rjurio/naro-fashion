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
import { Request, Response } from 'express';
import { AuthService, parseDurationMs } from './auth.service';
import { RegisterDto, LoginDto } from './dto';

// Fallback maxAge if the configured JWT expiration string is somehow unparseable
// (shouldn't happen — defaults are valid — but cookies need a number).
const FALLBACK_ACCESS_COOKIE_MS = 15 * 60 * 1000;
const FALLBACK_REFRESH_COOKIE_MS = 7 * 24 * 60 * 60 * 1000;
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const tenantId = req.headers['x-tenant-id'] as string | undefined;
    const user = await this.authService.register(dto, tenantId);
    return { message: 'Registration successful', user };
  }

  @Public()
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
    };
    const tokens = await this.authService.generateTokens(user);

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
      path: '/api/v1/auth/refresh',
    });

    return {
      message: 'Login successful',
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Body() body: { refreshToken?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    // Accept the refresh token from either an httpOnly cookie (browser) OR
    // a JSON body field (the SPA's localStorage-based flow uses this path).
    const refreshToken = req.cookies?.refresh_token || body?.refreshToken;
    const tokens = await this.authService.refreshTokens(refreshToken);

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
      path: '/api/v1/auth/refresh',
    });

    return {
      message: 'Tokens refreshed',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh' });
    return { message: 'Logged out' };
  }

  @Public()
  @Post('platform-login')
  @HttpCode(HttpStatus.OK)
  async platformLogin(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const admin = await this.authService.validatePlatformAdmin(body.email, body.password);
    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const tokens = await this.authService.generateTokens(admin);

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
      path: '/api/v1/auth/refresh',
    });

    return {
      message: 'Login successful',
      user: admin,
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
    @Body() data: { firstName?: string; lastName?: string; phone?: string },
  ) {
    return this.authService.updateProfile(user.id, data, user.isAdmin);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: { id: string; isAdmin?: boolean },
    @Body() data: { currentPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(user.id, data.currentPassword, data.newPassword, user.isAdmin);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('2fa')
  async toggle2FA(
    @CurrentUser() user: { id: string },
    @Body() data: { enabled: boolean },
  ) {
    return this.authService.toggle2FA(user.id, data.enabled);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() body: { token: string; newPassword: string }) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }
}
