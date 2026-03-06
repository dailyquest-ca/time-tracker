import { describe, it, expect } from 'vitest';
import {
  extractAcronym,
  levenshtein,
  resolveBroadCategory,
  resolveCategoryIdFromSnapshot,
  type CategoryRow,
} from '../categorize';

describe('extractAcronym', () => {
  it('extracts a 3+ uppercase acronym at the start', () => {
    expect(extractAcronym('PIS Standup')).toBe('PIS');
    expect(extractAcronym('ELAN - Test event')).toBe('ELAN');
    expect(extractAcronym('DOCUPLOAD release')).toBe('DOCUPLOAD');
  });

  it('extracts acronyms with numbers', () => {
    expect(extractAcronym('WOR3 meeting')).toBe('WOR3');
  });

  it('returns null for 2-letter prefixes (e.g. PO)', () => {
    expect(extractAcronym('PO meeting')).toBeNull();
    expect(extractAcronym('AI research')).toBeNull();
  });

  it('returns null for lowercase titles', () => {
    expect(extractAcronym('standup meeting')).toBeNull();
  });

  it('returns null for mixed-case words', () => {
    expect(extractAcronym('Learning session')).toBeNull();
  });

  it('returns null for empty strings', () => {
    expect(extractAcronym('')).toBeNull();
    expect(extractAcronym('   ')).toBeNull();
  });

  it('handles acronym at start with colon separator', () => {
    expect(extractAcronym('PIS:standup')).toBe('PIS');
  });

  it('handles acronym at start with hyphen separator', () => {
    expect(extractAcronym('PIS-standup')).toBe('PIS');
  });

  it('handles acronym that is the entire title', () => {
    expect(extractAcronym('PIS')).toBe('PIS');
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('PIS', 'PIS')).toBe(0);
  });

  it('returns 1 for single character difference', () => {
    expect(levenshtein('PIS', 'PIZ')).toBe(1);
    expect(levenshtein('ELAN', 'ELON')).toBe(1);
  });

  it('returns 1 for single insertion/deletion', () => {
    expect(levenshtein('PIS', 'PISS')).toBe(1);
    expect(levenshtein('ELAN', 'ELA')).toBe(1);
  });

  it('returns correct distance for larger differences', () => {
    expect(levenshtein('ABC', 'XYZ')).toBe(3);
  });

  it('handles empty strings', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('ABC', '')).toBe(3);
    expect(levenshtein('', 'AB')).toBe(2);
  });
});

describe('resolveBroadCategory', () => {
  it('matches learning keywords', () => {
    expect(resolveBroadCategory('Learning session about React')).toBe('Learning');
    expect(resolveBroadCategory('Golang training day')).toBe('Learning');
    expect(resolveBroadCategory('Online course module 3')).toBe('Learning');
  });

  it('matches 1:1 keywords', () => {
    expect(resolveBroadCategory('1:1 with manager')).toBe('1:1s');
    expect(resolveBroadCategory('One-on-one check-in')).toBe('1:1s');
  });

  it('returns null for unmatched titles', () => {
    expect(resolveBroadCategory('Sprint planning')).toBeNull();
    expect(resolveBroadCategory('Deploy to production')).toBeNull();
  });
});

describe('resolveCategoryIdFromSnapshot', () => {
  const categories: CategoryRow[] = [
    { id: 1, name: 'General tasks/meetings', archived: false },
    { id: 2, name: 'Learning', archived: false },
    { id: 3, name: '1:1s', archived: false },
    { id: 4, name: 'PIS', archived: false },
    { id: 5, name: 'ELAN', archived: false },
    { id: 6, name: 'WOR', archived: true },
  ];

  it('matches exact acronym (case-insensitive)', () => {
    expect(resolveCategoryIdFromSnapshot('PIS Standup', categories)).toBe(4);
    expect(resolveCategoryIdFromSnapshot('ELAN meeting', categories)).toBe(5);
  });

  it('returns null for unmatched acronym (no DB auto-create in snapshot mode)', () => {
    expect(resolveCategoryIdFromSnapshot('NEWPROJ planning', categories)).toBeNull();
  });

  it('fuzzy matches acronym with distance <= 1', () => {
    expect(resolveCategoryIdFromSnapshot('PIZ meeting', categories)).toBe(4); // PIZ -> PIS (dist 1)
  });

  it('does not fuzzy match with distance > 1', () => {
    expect(resolveCategoryIdFromSnapshot('XYZ meeting', categories)).toBeNull();
  });

  it('falls back to broad category for non-acronym titles', () => {
    expect(resolveCategoryIdFromSnapshot('Learning session', categories)).toBe(2);
    expect(resolveCategoryIdFromSnapshot('1:1 with manager', categories)).toBe(3);
  });

  it('falls back to General tasks/meetings for unmatched non-acronym', () => {
    expect(resolveCategoryIdFromSnapshot('Sprint planning', categories)).toBe(1);
  });

  it('skips archived categories for exact match', () => {
    expect(resolveCategoryIdFromSnapshot('WOR standup', categories)).toBeNull();
  });

  it('returns first active category if no default exists', () => {
    const noBroad: CategoryRow[] = [
      { id: 10, name: 'ProjectX', archived: false },
    ];
    expect(resolveCategoryIdFromSnapshot('Sprint planning', noBroad)).toBe(10);
  });

  it('returns null when no categories exist', () => {
    expect(resolveCategoryIdFromSnapshot('Anything', [])).toBeNull();
  });
});
