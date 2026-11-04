import { describe, expect, it } from 'vitest';
import { SLOT_KEYS } from '../src/sim/save';

describe('本地存档键', () => {
  it('星空列车的存档键都带 startrain. 前缀，与同域名下的地下城互不覆盖', () => {
    for (const k of Object.values(SLOT_KEYS)) expect(k.startsWith('startrain.')).toBe(true);
    expect(new Set(Object.values(SLOT_KEYS)).size).toBe(Object.values(SLOT_KEYS).length);
  });
});
