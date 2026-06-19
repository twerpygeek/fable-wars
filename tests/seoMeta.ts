import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(html, /<title>Fable Wars - Browser RTS Skirmish<\/title>/);
assert.match(html, /name="description"/);
assert.match(html, /rel="canonical" href="https:\/\/fablewars\.vercel\.app\/"/);
assert.match(html, /property="og:title" content="Fable Wars - Browser RTS Skirmish"/);
assert.match(html, /property="og:image" content="https:\/\/fablewars\.vercel\.app\/social\/fable-wars-og\.jpg"/);
assert.match(html, /name="twitter:card" content="summary_large_image"/);
assert.match(html, /"@type": "VideoGame"/);
assert.match(html, /"codeRepository": "https:\/\/github\.com\/twerpygeek\/fable-wars"/);
assert.match(html, /"sameAs": \["https:\/\/github\.com\/twerpygeek\/fable-wars", "https:\/\/iangoh\.com\/"\]/);
assert.equal(existsSync(new URL('../public/social/fable-wars-og.jpg', import.meta.url)), true);

console.log('PASS SEO meta');
