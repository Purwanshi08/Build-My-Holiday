// Tests for src/engine/time.js: HH:MM parsing (24:00), windows past midnight with inclusive ends,
// adding minutes across midnight/month ends, date arithmetic and weekdays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMinutes, fromMinutes, inWindow, addDays, weekday, addMinutes } from '../src/engine/time.js';

test('toMinutes parses HH:MM, with 24:00 = 1440', () => {
  assert.equal(toMinutes('00:00'), 0);
  assert.equal(toMinutes('06:30'), 390);
  assert.equal(toMinutes('23:59'), 1439);
  assert.equal(toMinutes('24:00'), 1440);
});

test('toMinutes rejects malformed or out-of-range times', () => {
  for (const bad of ['24:01', '25:00', '12:60', '6:30', '06:30:00', '', 'ab:cd', null, undefined, 390]) {
    assert.throws(() => toMinutes(bad), /Bad time/, String(bad));
  }
});

test('fromMinutes formats and round-trips', () => {
  assert.equal(fromMinutes(0), '00:00');
  assert.equal(fromMinutes(390), '06:30');
  assert.equal(fromMinutes(1440), '24:00');
  for (const t of ['00:00', '09:05', '23:59', '24:00']) assert.equal(fromMinutes(toMinutes(t)), t);
  assert.throws(() => fromMinutes(-1));
  assert.throws(() => fromMinutes(1441));
  assert.throws(() => fromMinutes(1.5));
});

test('inWindow: normal window, both ends included', () => {
  assert.equal(inWindow('06:00', '06:00', '23:00'), true);
  assert.equal(inWindow('23:00', '06:00', '23:00'), true);
  assert.equal(inWindow('12:00', '06:00', '23:00'), true);
  assert.equal(inWindow('05:59', '06:00', '23:00'), false);
  assert.equal(inWindow('23:01', '06:00', '23:00'), false);
});

test('inWindow: window ending at 24:00', () => {
  assert.equal(inWindow('23:59', '05:00', '24:00'), true);
  assert.equal(inWindow('24:00', '05:00', '24:00'), true);
  assert.equal(inWindow('04:59', '05:00', '24:00'), false);
  assert.equal(inWindow('00:00', '00:00', '24:00'), true);
});

test('inWindow: window running past midnight (06:00-00:30)', () => {
  assert.equal(inWindow('06:00', '06:00', '00:30'), true);
  assert.equal(inWindow('23:59', '06:00', '00:30'), true);
  assert.equal(inWindow('00:00', '06:00', '00:30'), true);
  assert.equal(inWindow('00:15', '06:00', '00:30'), true);
  assert.equal(inWindow('00:30', '06:00', '00:30'), true);
  assert.equal(inWindow('00:31', '06:00', '00:30'), false);
  assert.equal(inWindow('05:59', '06:00', '00:30'), false);
  assert.equal(inWindow('03:00', '06:00', '00:30'), false);
});

test('inWindow accepts minutes as well as strings; equal ends = single instant', () => {
  assert.equal(inWindow(390, 360, 1380), true);
  assert.equal(inWindow('06:30', 360, '23:00'), true);
  assert.equal(inWindow('10:00', '10:00', '10:00'), true);
  assert.equal(inWindow('10:01', '10:00', '10:00'), false);
});

test('addDays moves across month and year ends, negative too', () => {
  assert.equal(addDays('2027-04-10', 0), '2027-04-10');
  assert.equal(addDays('2027-04-10', 6), '2027-04-16');
  assert.equal(addDays('2027-04-30', 1), '2027-05-01');
  assert.equal(addDays('2027-04-01', -1), '2027-03-31');
  assert.equal(addDays('2027-12-31', 1), '2028-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.throws(() => addDays('2027-4-1', 1), /Bad date/);
});

test('weekday uses the UTC trick: SUN..SAT', () => {
  assert.equal(weekday('2027-04-10'), 'SAT');
  assert.equal(weekday('2027-04-11'), 'SUN');
  assert.equal(weekday('2027-04-12'), 'MON');
  assert.equal(weekday('2027-04-16'), 'FRI');
  assert.throws(() => weekday('10/04/2027'), /Bad date/);
});

test('addMinutes within a day', () => {
  assert.equal(addMinutes('2027-04-10T10:30', 60), '2027-04-10T11:30');
  assert.equal(addMinutes('2027-04-10T10:30', 0), '2027-04-10T10:30');
});

test('addMinutes rolls over midnight, month end, and backwards', () => {
  assert.equal(addMinutes('2027-04-09T23:50', 70), '2027-04-10T01:00');
  assert.equal(addMinutes('2027-04-10T23:00', 60), '2027-04-11T00:00');
  assert.equal(addMinutes('2027-04-30T22:00', 180), '2027-05-01T01:00');
  assert.equal(addMinutes('2027-04-10T00:10', -20), '2027-04-09T23:50');
  assert.equal(addMinutes('2027-04-01T00:00', -1), '2027-03-31T23:59');
  assert.equal(addMinutes('2027-04-10T08:00', 3 * 1440), '2027-04-13T08:00');
});

test('addMinutes accepts catalog seconds and drops them; rejects bad input', () => {
  assert.equal(addMinutes('2027-04-03T20:30:00', 60), '2027-04-03T21:30');
  assert.throws(() => addMinutes('2027-04-03 20:30', 1));
  assert.throws(() => addMinutes('2027-04-03T20:30', 1.5));
});
