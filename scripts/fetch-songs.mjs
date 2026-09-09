#!/usr/bin/env node
// タグ「本当のルーキー祭り2026秋」が付いた全動画を投稿日時が古い順に取得し、
// src/data/songs.json を更新するスクリプト。
//
// 使い方:
//   node scripts/fetch-songs.mjs
//
// すでに songs.json に書いてある comment / artist は URL をキーに引き継がれるので、
// 再実行しても書いた感想が消えることはありません(新しく追加された動画だけ comment が空で入ります)。
//
// 使っているAPI:
//   - スナップショット検索API v2 (公式・タグ検索用)
//     https://site.nicovideo.jp/search-api-docs/snapshot
//   - getthumbinfo (非公式だが広く使われている・投稿者名の取得用)

import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TAG = '本当のルーキー祭り2026秋';
const SNAPSHOT_ENDPOINT =
  'https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search';
const USER_AGENT = 'rookie_fes_26a (personal project, non-commercial)';
const OUTPUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/data/songs.json'
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

async function fetchAllFromSnapshot() {
  const limit = 100;
  let offset = 0;
  let total = Infinity;
  const items = [];

  while (offset < total) {
    const params = new URLSearchParams({
      q: TAG,
      targets: 'tagsExact',
      fields: 'contentId,title,startTime',
      _sort: '+startTime',
      _offset: String(offset),
      _limit: String(limit),
      _context: 'rookie_fes_26a',
    });

    const res = await fetch(`${SNAPSHOT_ENDPOINT}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!res.ok) {
      throw new Error(`スナップショット検索APIエラー: HTTP ${res.status}`);
    }

    const json = await res.json();
    if (json.meta.status !== 200) {
      throw new Error(`スナップショット検索APIエラー: ${json.meta.errorMessage}`);
    }

    total = json.meta.totalCount;
    items.push(...json.data);
    offset += limit;

    if (offset < total) {
      await sleep(500); // 連続リクエストへの配慮
    }
  }

  return items;
}

async function fetchNickname(contentId) {
  const res = await fetch(`https://ext.nicovideo.jp/api/getthumbinfo/${contentId}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  const xml = await res.text();
  const userMatch = xml.match(/<user_nickname>(.*?)<\/user_nickname>/);
  const chMatch = xml.match(/<ch_name>(.*?)<\/ch_name>/);
  const match = userMatch ?? chMatch;
  return match ? decodeEntities(match[1]) : '(投稿者名の取得に失敗しました)';
}

async function loadExisting() {
  try {
    const raw = await readFile(OUTPUT_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function main() {
  console.log(`タグ「${TAG}」で検索中...`);
  const items = await fetchAllFromSnapshot();
  console.log(`${items.length}件ヒットしました。投稿者名を取得します...`);

  const existing = await loadExisting();
  const existingByUrl = new Map(existing.map((s) => [s.url, s]));

  const result = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const url = `https://www.nicovideo.jp/watch/${item.contentId}`;
    const prev = existingByUrl.get(url);

    console.log(`  [${i + 1}/${items.length}] ${item.title}`);
    const artist = prev?.artist ?? (await fetchNickname(item.contentId));
    await sleep(300);

    result.push({
      order: i + 1,
      title: item.title,
      artist,
      url,
      postedAt: item.startTime,
      comment: prev?.comment ?? '',
    });
  }

  await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf-8');
  console.log(`\n書き出し完了: ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
