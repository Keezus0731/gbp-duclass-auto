// post.js — 月木に1本、投稿バンクから未使用のMEO投稿を選んでGBPへ自動投稿する。
// 認証はGitHub Actions Secretsの環境変数から読む（リポジトリには秘密を置かない）:
//   GBP_CLIENT_ID / GBP_CLIENT_SECRET / GBP_REFRESH_TOKEN
// 画像は IMAGE_BASE_URL（例: https://raw.githubusercontent.com/<user>/<repo>/main）が
// 設定され、かつ images/<theme>/ に画像があれば付与。なければテキストのみで投稿。
import { OAuth2Client } from 'google-auth-library';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const config = read('config.json');
const bank = read('bank.json');
const historyPath = path.join(DIR, 'history.json');
const history = fs.existsSync(historyPath) ? read('history.json') : [];

const { GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN } = process.env;
if (!GBP_CLIENT_ID || !GBP_CLIENT_SECRET || !GBP_REFRESH_TOKEN) {
  console.error('❌ 認証情報(環境変数 GBP_CLIENT_ID / GBP_CLIENT_SECRET / GBP_REFRESH_TOKEN)が不足しています。');
  process.exit(1);
}

// ---- 投稿ネタの選択：未使用を優先、無ければ最も昔に使ったものを再利用（警告） ----
const usedIds = new Set(history.map((h) => h.id));
let pick = bank.find((p) => !usedIds.has(p.id));
let recycled = false;
if (!pick) {
  recycled = true;
  const lastUsedAt = {};
  for (const h of history) lastUsedAt[h.id] = h.postedAt;
  pick = [...bank].sort((a, b) => (lastUsedAt[a.id] || '') .localeCompare(lastUsedAt[b.id] || ''))[0];
  console.warn('⚠️ 投稿バンクを使い切りました。最も昔のネタを再利用します。早めに新しいネタの補充を。');
}
console.log(`選択: [${pick.id}] type=${pick.type} theme=${pick.theme} / ${pick.title}`);

// ---- 画像の選択（任意） ----
function pickImageUrl(theme) {
  const base = process.env.IMAGE_BASE_URL;
  if (!base) return null;
  const dir = path.join(DIR, 'images', theme);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  if (!files.length) return null;
  // 直前に使った画像を避けてランダム選択
  const lastImg = history.length ? history[history.length - 1].image : null;
  const candidates = files.length > 1 && lastImg ? files.filter((f) => `${theme}/${f}` !== lastImg) : files;
  const chosen = candidates[Math.floor(((history.length * 2654435761) >>> 0) % candidates.length)];
  return { rel: `${theme}/${chosen}`, url: `${base.replace(/\/$/, '')}/images/${theme}/${encodeURIComponent(chosen)}` };
}
const img = pickImageUrl(pick.theme);

// ---- GBP localPosts.create ----
const client = new OAuth2Client(GBP_CLIENT_ID, GBP_CLIENT_SECRET);
client.setCredentials({ refresh_token: GBP_REFRESH_TOKEN });

const summary = `${pick.title}\n\n${pick.body}`.slice(0, 1490);
const ctaUrl = pick.type === 'fair' ? config.cta.fair : config.cta.top;
const post = {
  languageCode: config.languageCode || 'ja',
  summary,
  topicType: 'STANDARD',
  callToAction: { actionType: 'LEARN_MORE', url: ctaUrl },
};
if (img) post.media = [{ mediaFormat: 'PHOTO', sourceUrl: img.url }];

const { token } = await client.getAccessToken();
if (!token) { console.error('❌ アクセストークンを取得できませんでした（refresh_token要確認）'); process.exit(1); }

if (process.env.DRY_RUN) {
  console.log('🧪 DRY_RUN: 実際の投稿は行いません。送信予定の内容:');
  console.log(JSON.stringify(post, null, 2));
  console.log('✅ 認証OK（アクセストークン取得成功）。本番なら上記内容で投稿されます。');
  process.exit(0);
}

const url = `https://mybusiness.googleapis.com/v4/${config.locationParent}/localPosts`;
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(post),
});
const text = await res.text();
if (!res.ok) {
  console.error(`❌ 投稿失敗 ${res.status}\n${text}`);
  process.exit(1);
}
const created = JSON.parse(text);
console.log(`✅ 投稿成功: ${created.name || '(name不明)'}  画像=${img ? img.rel : 'なし'}  CTA=${ctaUrl}`);

// ---- 履歴を追記して保存（ワークフローがコミットする） ----
history.push({
  id: pick.id,
  postedAt: new Date().toISOString(),
  theme: pick.theme,
  type: pick.type,
  image: img ? img.rel : null,
  recycled,
});
fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');
const remaining = bank.length - new Set(history.map((h) => h.id)).size;
console.log(`履歴更新。残り未使用ネタ: ${remaining}/${bank.length} 本`);
