import { getNextLeg } from '../src/database';

describe('database helpers', () => {
  test('getNextLeg alternates between Right and Left', () => {
    expect(getNextLeg(undefined)).toBe('Right');
    expect(getNextLeg('Right')).toBe('Left');
    expect(getNextLeg('Left')).toBe('Right');
  });
});
