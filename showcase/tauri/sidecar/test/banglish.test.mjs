import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreCodeSwitch, cleanWhisperArtifacts, isPureEnglish } from '../banglish.mjs';

test('code-switching: handles example 1 (WhatsApp and message)', () => {
  const spokenBn = 'হ্যাঁ, ওয়াথ সাউপ ওপেন করে আমাকে মেসেজ করুন।';
  const out = restoreCodeSwitch(spokenBn, 'WhatsApp message');
  assert.equal(out, 'হ্যাঁ, WhatsApp ওপেন করে আমাকে message করুন।');
});

test('code-switching: handles example 2 (setting and screenshot)', () => {
  const spokenBn = 'হ্যাঁ, সেটিং এ গিয়ে আমাকে স্ক্রিনশট দিন।';
  const out = restoreCodeSwitch(spokenBn, 'setting screenshot');
  assert.equal(out, 'হ্যাঁ, setting এ গিয়ে আমাকে screenshot দিন।');
});

test('code-switching: handles attached Bengali inflections', () => {
  assert.equal(restoreCodeSwitch('আমার ল্যাপটপে প্রবলেম হচ্ছে'), 'আমার laptop এ problem হচ্ছে');
  assert.equal(restoreCodeSwitch('গুগলে সার্চ করুন'), 'Google এ search করুন');
  assert.equal(restoreCodeSwitch('হোয়াটসঅ্যাপে মেসেজ পাঠান'), 'WhatsApp এ message পাঠান');
  assert.equal(restoreCodeSwitch('এই ফাইলগুলো আপলোড করুন'), 'এই file গুলো upload করুন');
  assert.equal(restoreCodeSwitch('স্ক্রিনশটটা আমাকে দিন'), 'screenshot টা আমাকে দিন');
});

test('code-switching: cleans Whisper decoding loops', () => {
  const looped = '। হ্যাঁ? ওয়াথ সাউপ ওপেন করে আমাকে মেসেজ করুন। হ্যাঁ? হ্যাঁ? হ্যাঁ? হ্যাঁ?';
  const out = restoreCodeSwitch(looped, 'WhatsApp message');
  assert.equal(out, 'হ্যাঁ, WhatsApp ওপেন করে আমাকে message করুন।');
});

test('code-switching: preserves pure English speech', () => {
  const apple = 'Can you please open the settings and take a screenshot';
  const bn = 'কেন ইউ প্লিজ ওপেন দ্য সেটিংস এন্ড টেইক এ স্ক্রিন শট';
  assert.equal(isPureEnglish(apple, bn), true);
  assert.equal(restoreCodeSwitch(bn, apple), apple);
});

test('code-switching: preserves pure Bengali speech without changes', () => {
  const bn = 'আমি ভালো আছি, আপনি কেমন আছেন?';
  assert.equal(restoreCodeSwitch(bn, ''), 'আমি ভালো আছি, আপনি কেমন আছেন?');
});

test('code-switching: handles Hey WhatsApp open kore amake message korun', () => {
  const whisper = 'হ্যাঁ? ওয়াটস আউট ওপেন করে আমাকে মেসেজ করুন।';
  const apple = 'Hey, WhatsApp open Kore Amake message Korun.';
  const out = restoreCodeSwitch(whisper, apple);
  assert.equal(out, 'হ্যাঁ, WhatsApp open করে আমাকে message করুন।');
});
