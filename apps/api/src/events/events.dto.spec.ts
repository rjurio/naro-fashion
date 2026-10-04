import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddMediaDto, CustomerSubmitEventDto } from './events.service';

/** Regression #4: socialLinks must be https URLs on whitelisted keys; media URLs https or /uploads. */
async function errorsFor(cls: any, body: any) {
  const errs = await validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true });
  return JSON.stringify(errs);
}

describe('events DTO validation', () => {
  const base = { title: 'W', eventDate: '2026-01-01', productId: 'p1' };

  it('accepts https social links and blank fields', async () => {
    expect(await errorsFor(CustomerSubmitEventDto, { ...base, socialLinks: { instagram: 'https://instagram.com/x', tiktok: '' } })).toBe('[]');
  });
  it('rejects javascript:/http: links', async () => {
    expect(await errorsFor(CustomerSubmitEventDto, { ...base, socialLinks: { instagram: 'javascript:alert(1)' } })).toMatch(/instagram must be an https URL/);
    expect(await errorsFor(CustomerSubmitEventDto, { ...base, socialLinks: { facebook: 'http://facebook.com/x' } })).toMatch(/facebook must be an https URL/);
  });
  it('rejects non-whitelisted social keys', async () => {
    expect(await errorsFor(CustomerSubmitEventDto, { ...base, socialLinks: { evil: 'https://x.com' } })).toMatch(/evil/);
  });
  it('media url must be https or /uploads/', async () => {
    expect(await errorsFor(AddMediaDto, { url: '/uploads/events/a.jpg' })).toBe('[]');
    expect(await errorsFor(AddMediaDto, { url: 'https://cdn.example.com/a.jpg' })).toBe('[]');
    expect(await errorsFor(AddMediaDto, { url: 'javascript:alert(1)' })).toMatch(/url must be/);
    expect(await errorsFor(AddMediaDto, { url: 'http://x.com/a.jpg' })).toMatch(/url must be/);
  });
});
