import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { extractListingsFromText } from '../src/extractors/text-extractor.js';

test('offered roommate-wanted posts stay offerings and do not collapse into roommate_search', () => {
  const [listing] = extractListingsFromText(`
    Roommate Wanted - Available April 1st
    Rent: $1,600/month (utilities included)
    Private room in Williamsburg.
  `);

  assert.equal(listing.postIntent, 'offering');
  assert.equal(listing.listingType, 'room_in_shared');
  assert.equal(listing.location.neighborhood, 'Williamsburg');
  assert.equal(listing.location.borough, 'Brooklyn');
  assert.equal(listing.pricing.amount, 1600);
  assert.equal(listing.confidence.overall > 0.75, true);
});

test('wanted roommate-hunt posts stay wanted and keep roommate_search separate from housing offers', () => {
  const [listing] = extractListingsFromText(`
    Looking for up to 2 roommates to find a place in or close to Greenpoint.
    My budget is $1,600 and move-in is April 1.
  `);

  assert.equal(listing.postIntent, 'wanted');
  assert.equal(listing.listingType, 'roommate_search');
  assert.equal(listing.location.neighborhood, 'Greenpoint');
  assert.equal(listing.location.borough, 'Brooklyn');
});

test('ISO subletter posts are treated as offered sublets when the poster is filling a spot', () => {
  const [listing] = extractListingsFromText(`
    ISO subletter in Williamsburg (April 1-May 17)
    2 bed / 1 bath apartment in a 2nd floor walk up.
    You'll be living with my roommate and his two very friendly cats.
    Rent is $2,000/month. Message me if interested.
  `);

  assert.equal(listing.postIntent, 'offering');
  assert.equal(listing.listingType, 'sublet');
  assert.equal(listing.location.neighborhood, 'Williamsburg');
  assert.equal(listing.location.borough, 'Brooklyn');
});

test('wanted apartment searches do not mis-infer Manhattan borough from commute text', () => {
  const [listing] = extractListingsFromText(`
    ISO NEW LEASE OR LEASE TAKEOVER FOR ENTIRE APARTMENT!
    We are four young professionals in our mid to late twenties looking for a 4 bed, 1.5+ baths apartment rental in Brooklyn that's roughly $4,400 a month.
    May 1st move in.
    Preferably in a neighborhood with quick and easy access into Manhattan.
  `);

  assert.equal(listing.postIntent, 'wanted');
  assert.equal(listing.listingType, 'entire_apartment');
  assert.equal(listing.location.borough, 'Brooklyn');
  assert.match(listing.notes.ambiguities.join(' | '), /Listing type is mixed or unclear/);
});

test('street names like Manhattan Ave do not force the Manhattan borough on offered room posts', () => {
  const [listing] = extractListingsFromText(`
    Looking for roommate for this 2BR/2BA apartment on Grand st and Manhattan ave.
    Must be able to move-in mid-march.
  `);

  assert.equal(listing.postIntent, 'offering');
  assert.equal(listing.listingType, 'room_in_shared');
  assert.equal(listing.location.borough, null);
  assert.equal(listing.location.rawText, 'Grand st and Manhattan ave');
});

test('multi-option posts split into separate listings and lower confidence when pricing is mixed', () => {
  const bodyText = fs.readFileSync(path.resolve('examples/michaela-kerem-post.txt'), 'utf8');
  const listings = extractListingsFromText(bodyText);

  assert.equal(listings.length, 2);
  assert.equal(listings[0].postIntent, 'offering');
  assert.equal(listings[0].listingType, 'room_in_shared');
  assert.equal(listings[0].pricing.amount, 1500);
  assert.match(listings[0].notes.ambiguities.join(' | '), /Mixed pricing periods detected/);
  assert.equal(listings[0].confidence.overall < 0.7, true);

  assert.equal(listings[1].postIntent, 'offering');
  assert.equal(listings[1].listingType, 'entire_apartment');
  assert.equal(listings[1].location.neighborhood, 'Williamsburg');
  assert.equal(listings[1].location.borough, 'Brooklyn');
});

test('confidence drops on sparse wanted posts with little location or pricing evidence', () => {
  const [sparse] = extractListingsFromText(`
    Hello.
    Seeking short-term sublet for March 16-29.
    Studio / 1BR / full place preferred.
  `);
  const [detailed] = extractListingsFromText(`
    Greenpoint Luxury 1BR w/ Deck + Pool | Furnished or Unfurnished
    Relocating for work and offering a lease takeover on my Greenpoint apartment.
    Lease Term: March 20 – July 31, 2026.
    Rent: $4,325 / month.
  `);

  assert.equal(sparse.postIntent, 'wanted');
  assert.equal(sparse.listingType, 'sublet');
  assert.equal(sparse.confidence.overall < 0.5, true);
  assert.match(sparse.notes.ambiguities.join(' | '), /Location not confidently detected/);
  assert.match(sparse.notes.ambiguities.join(' | '), /Price not confidently detected/);

  assert.equal(detailed.postIntent, 'offering');
  assert.equal(detailed.listingType, 'lease_takeover');
  assert.equal(detailed.confidence.overall > sparse.confidence.overall, true);
});
