import { readFileSync } from 'fs';
import { join } from 'path';
import { NOT_AVAILABLE_FOR_RENTAL } from '../rentals/rental-sale-guard';

/**
 * Release 1b (owner decision 2026-11-11): the same rental page handles gowns,
 * bouquets and other items, so shared rental messages are item-neutral, and
 * in Swahili use "bidhaa", never "gauni". The booking page shows the
 * translated message for "not available" refusals instead of the API's
 * English text. Reads the storefront source (it has no test runner).
 */
const SF = join(__dirname, '..', '..', '..', 'storefront');
const read = (rel: string) => readFileSync(join(SF, rel), 'utf8');
const msgs = (lang: string) => JSON.parse(read(`messages/${lang}.json`));

describe('storefront rental refusal wording (release 1b)', () => {
  it('Swahili notAvailable is the owner-approved item-neutral sentence', () => {
    expect(msgs('sw').rentals.notAvailable).toBe(
      'Bidhaa hii haipatikani kwa kukodi kwa tarehe ulizochagua. Tafadhali chagua tarehe nyingine.',
    );
  });

  it('neither language names a gown in the shared refusal', () => {
    expect(msgs('sw').rentals.notAvailable).not.toMatch(/gauni/i);
    expect(msgs('en').rentals.notAvailable).not.toMatch(/gown/i);
    expect(msgs('en').rentals.notAvailable).toMatch(/this item/i);
  });

  it('the booking page maps both not-available codes to the translated message', () => {
    const s = read('app/rentals/[slug]/page.tsx');
    expect(s).toMatch(/code === 'NOT_AVAILABLE_FOR_DATES' \|\| code === 'NOT_AVAILABLE_FOR_RENTAL'/);
    expect(s).toMatch(/toast\.error\(t\('rentals\.notAvailable'\)\)/);
    // the code string the page checks is the one the API sends
    expect(NOT_AVAILABLE_FOR_RENTAL).toBe('NOT_AVAILABLE_FOR_RENTAL');
  });
});
