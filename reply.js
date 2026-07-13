// reply.js — デュクラス大阪の新着口コミに自動返信する（パイロット）。
// 方針：
//   - 4〜5★               → お礼の定型文で自動返信（positive）
//   - 1〜3★ かつ コメント無し → 中立の定型文で自動返信（neutral）
//   - 1〜3★ かつ コメント有り → 自動返信せず flagged-reviews.json に記録（人が手動対応）
// 既に返信済み（reviewReply有）や、replied.json に記録済みのものはスキップ。
// スパム防止のため1回の実行で返信する上限を設ける（MAX_REPLIES）。
import { OAuth2Client } from 'google-auth-library';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const config = read('config.json');
const tpl = read('reply-templates.json');
const repliedPath = path.join(DIR, 'replied.json');
const replied = fs.existsSync(repliedPath) ? read('replied.json') : [];
const flaggedPath = path.join(DIR, 'flagged-reviews.json');
const flagged = fs.existsSync(flaggedPath) ? read('flagged-reviews.json') : [];

const MAX_REPLIES = Number(process.env.MAX_REPLIES || 10);
const STAR = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

const { GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN } = process.env;
if (!GBP_CLIENT_ID || !GBP_CLIENT_SECRET || !GBP_REFRESH_TOKEN) {
  console.error('認証情報(環境変数)が不足しています。');
  process.exit(1);
}
const client = new OAuth2Client(GBP_CLIENT_ID, GBP_CLIENT_SECRET);
client.setCredentials({ refresh_token: GBP_REFRESH_TOKEN });

async function api(method, url, body) {
  const { token } = await client.getAccessToken();
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text };
}

// GBPのレスポンスは本文に生の制御文字が入りJSON.parseが失敗するため空白化してから解析
const CTRL = new RegExp('[\\u0000-\\u001F]', 'g');
const parse = (t) => JSON.parse(t.replace(CTRL, ' '));

async function listAllReviews() {
  const out = [];
  let pageToken = '';
  do {
    const url = `https://mybusiness.googleapis.com/v4/${config.locationParent}/reviews?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const { ok, status, text } = await api('GET', url);
    if (!ok) throw new Error(`reviews.list ${status} ${text.slice(0, 200)}`);
    const d = parse(text);
    (d.reviews || []).forEach((r) => out.push(r));
    pageToken = d.nextPageToken || '';
  } while (pageToken && out.length < 400);
  return out;
}

const pick = (arr, seed) => arr[Math.abs([...String(seed)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % arr.length];
const repliedSet = new Set(replied.map((x) => x.reviewId));

const reviews = await listAllReviews();
console.log(`取得口コミ: ${reviews.length}件`);

let replies = 0, flags = 0, skipped = 0;
reviews.sort((a, b) => (b.createTime || '').localeCompare(a.createTime || '')); // 新しい順

for (const rv of reviews) {
  const id = rv.reviewId;
  if (!id || repliedSet.has(id) || rv.reviewReply) { skipped++; continue; }
  const rating = STAR[rv.starRating] || 0;
  const hasComment = !!(rv.comment && rv.comment.trim());

  if (rating <= 3 && hasComment) {
    if (!flagged.find((f) => f.reviewId === id)) {
      flagged.push({ reviewId: id, rating, comment: rv.comment.slice(0, 500), createTime: rv.createTime, reviewer: (rv.reviewer && rv.reviewer.displayName) || '' });
      flags++;
      console.log(`[要手動] ${rating}star ${(rv.comment || '').slice(0, 40).replace(/\s+/g, ' ')}`);
    }
    continue;
  }

  if (replies >= MAX_REPLIES) continue;

  const bucket = rating >= 4 ? tpl.positive : tpl.neutral;
  const comment = pick(bucket, id);

  if (process.env.DRY_RUN) {
    console.log(`[DRY ${rating}star ${hasComment ? 'コメント有' : '星のみ'}] ${rating >= 4 ? 'positive' : 'neutral'}: ${comment.slice(0, 26)}`);
    replies++;
    continue;
  }

  const name = `${config.locationParent}/reviews/${id}`;
  const res = await api('PUT', `https://mybusiness.googleapis.com/v4/${name}/reply`, { comment });
  if (!res.ok) { console.error(`返信失敗 ${rating}star ${res.status} ${res.text.slice(0, 120)}`); continue; }
  replied.push({ reviewId: id, rating, repliedAt: new Date().toISOString(), template: rating >= 4 ? 'positive' : 'neutral' });
  repliedSet.add(id);
  replies++;
  console.log(`返信OK ${rating}star ${hasComment ? 'コメント有' : '星のみ'}`);
}

if (!process.env.DRY_RUN) {
  fs.writeFileSync(repliedPath, JSON.stringify(replied, null, 2) + '\n');
  fs.writeFileSync(flaggedPath, JSON.stringify(flagged, null, 2) + '\n');
}
console.log(`\n=== 完了: 自動返信 ${replies}件 / 要手動 ${flags}件 / スキップ ${skipped}件 ===`);
if (flags > 0) console.log('低評価コメントは flagged-reviews.json に記録。人が手動で返信してください。');
