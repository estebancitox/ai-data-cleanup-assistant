import { expect, it } from 'vitest';
import { diffValues, showWhitespace, unchanged } from './diff';

const same = (text: string) => ({ text, changed: false });
const marked = (text: string) => ({ text, changed: true });

it('marks exactly the characters a fix takes out', () => {
  expect(diffValues(' $1,250.00', '1250.00')).toEqual({
    from: [marked(' $'), same('1'), marked(','), same('250.00')],
    to: [same('1250.00')],
  });
  expect(diffValues('Titanium   rail', 'Titanium rail')).toEqual({
    from: [same('Titanium '), marked('  '), same('rail')],
    to: [same('Titanium rail')],
  });
});

it('finds spaces removed at either end', () => {
  expect(diffValues(' Wheels', 'Wheels')).toEqual({ from: [marked(' '), same('Wheels')], to: [same('Wheels')] });
  expect(diffValues('Wheels  ', 'Wheels')).toEqual({ from: [same('Wheels'), marked('  ')], to: [same('Wheels')] });
});

it('marks exactly the characters a fix adds', () => {
  expect(diffValues('2024-3-5', '2024-03-05')).toEqual({
    from: [same('2024-3-5')],
    to: [same('2024-'), marked('0'), same('3-'), marked('0'), same('5')],
  });
});

it('marks the part between the shared ends when characters are replaced', () => {
  expect(diffValues('BRAKES', 'Brakes')).toEqual({
    from: [same('B'), marked('RAKES')],
    to: [same('B'), marked('rakes')],
  });
  expect(diffValues('Mar 5, 2024', '2024-03-05')).toEqual({
    from: [marked('Mar 5, 2024')],
    to: [marked('2024-03-05')],
  });
  expect(diffValues('Alloy hub', 'Alloy rotor hub').to).toEqual([same('Alloy '), marked('rotor '), same('hub')]);
});

it('handles a value that is emptied, and two equal values', () => {
  expect(diffValues('n/a', '')).toEqual({ from: [marked('n/a')], to: [] });
  expect(diffValues('same', 'same')).toEqual({ from: [same('same')], to: [same('same')] });
  expect(diffValues('', '')).toEqual({ from: [], to: [] });
  expect(unchanged('')).toEqual([]);
});

it('the pieces of each side put its value back together', () => {
  const pairs = [
    [' $1,250.00', '1250.00'],
    ['Mar 5, 2024', '2024-03-05'],
    ['aaa', 'aa'],
    ['abcabc', 'abc'],
    ['x😀y', 'x😃y'],
    ['Steel hub', 'Carbon rail'],
  ];
  for (const [from, to] of pairs) {
    const diff = diffValues(from, to);
    expect(diff.from.map((segment) => segment.text).join('')).toBe(from);
    expect(diff.to.map((segment) => segment.text).join('')).toBe(to);
  }
});

it('draws whitespace so that it can be seen', () => {
  expect(showWhitespace('  a\tb\n')).toBe('··a→b↵');
});
