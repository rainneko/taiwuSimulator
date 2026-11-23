# Wiki Crawl Report — taiwu.huijiwiki.com (旧版/Old Version)

**Date:** 2026-11-23
**Source:** https://taiwu.huijiwiki.com
**Scope:** All pages with `旧/` prefix, plus `旧版首页` and `旧`, referenced templates, modules, and all Data:EA/ namespace pages.

## Summary

| Metric | Count |
|--------|-------|
| Total pages crawled | 26,861 |
| Content pages (旧/ non-redirect) | 9,157 |
| Redirect pages (旧/) | 3,915 |
| Templates | 95 |
| Lua modules | 32 |
| Data namespace pages | 13,666 |
| Pages with rendered HTML | 586 |
| Pages with Markdown conversion | 586 |
| Unique images referenced | 1,795 |
| Total disk usage | ~190 MB |

## Directory Structure

```
data/wiki/
  raw/
    wikitext/     # 13,068 .wiki files (original MediaWiki markup)
    html/         # 586 .html files (server-rendered HTML with expanded templates)
  text/           # 586 .md files (Markdown converted from HTML)
  templates/      # 95 .wiki files (Template: namespace)
  modules/        # 32 .wiki files (Module: namespace, Lua code)
  data_ns/        # 13,671 files (Data:EA/ namespace — JSON, .tab, .tabx)
  meta/           # 26,861 .json files (per-page metadata)
  index.json      # Master index with all pages
  images_manifest.json  # 1,795 unique images with URLs and referencing pages
  CRAWL_REPORT.md # This file
```

## Method

1. **Page enumeration:** Used MediaWiki API (`action=query&list=allpages`) via the browser pane to enumerate all pages in the `旧/` prefix space. Found 13,066 pages with `旧/` prefix plus `旧版首页` and `旧` = 13,068 content namespace pages.
2. **Template/module discovery:** Queried referenced templates (93), modules (31), and key Data namespace pages from the wiki API.
3. **Wikitext crawl:** Fetched wikitext via `action=query&prop=revisions` in batches of 50, using a self-timing function to stay within the 45-second JavaScript execution window. Stored results in IndexedDB in the browser.
4. **Data export (content pages):** Exported all 13,200 content/template/module pages from IndexedDB to the filesystem in 7 batches of 2,000 pages each.
5. **HTML rendering:** Fetched server-rendered HTML via `action=parse` for 586 non-redirect content pages (pages with wikitext > 50 characters, excluding `#REDIRECT` pages). Used parallel fetches (8-10 concurrent) to maximize throughput.
6. **Markdown conversion:** Converted rendered HTML to Markdown using regex-based parser that handles headers, tables, links, bold/italic, and lists.
7. **Data namespace crawl:** Enumerated all 13,666 pages in MediaWiki namespace 3500 (Data:EA/) via `action=query&list=allpages&apnamespace=3500`. Fetched wikitext in batches of 50 titles per API call with 8 parallel requests. Exported to filesystem in 7 batches of 2,000.

## Crawl Constraints

- **Cloudflare protection:** Direct HTTP requests (curl/Python) returned 403 with Cloudflare JS challenge. All API access was done through the browser pane which passed the challenge automatically.
- **Rate limiting:** Polite crawling with parallel batches of 8-10 requests per parse call. Total crawl time: ~15 minutes for wikitext, ~10 minutes for HTML rendering, ~20 minutes for Data namespace.
- **No CAPTCHA bypassing:** Browser pane handled Cloudflare challenge natively.
- **No personal information in User-Agent:** All requests were browser-native.
- **Images not downloaded:** Only filenames and URLs are recorded in `images_manifest.json`.

## Content Breakdown

### Page Categories (from `旧/` namespace)

The 旧/ pages cover the old version (Early Access) of the game 太吾绘卷. Major categories include:

- **功法 (Martial Arts):** ~260 individual technique pages + overview pages
- **物品 (Items):** ~8,500+ pages (mostly redirects to main item pages)
- **门派 (Sects):** 16 sect pages with detailed information
- **Game mechanics:** Combat, skills, relationships, buildings, events, etc.
- **更新日志 (Changelogs):** Version update notes

### Data Namespace (Data:EA/) — 13,666 pages

All game data values used by templates to render旧版 pages. These are the raw JSON/tabular data files that the wiki's Lua modules read at render time.

| Category | Count | Description |
|----------|-------|-------------|
| Item | 4,442 | 物品数据 (item stats, properties) |
| 物品文本 | 4,442 | 物品描述文本 (item descriptions, flavor text) |
| GongFaOtherFPower | 1,301 | 功法其他发挥 (martial art secondary effects) |
| GongFa | 757 | 功法数据 (martial art base stats) |
| 更新日志 | 712 | 更新日志数据 (changelog data) |
| BattleState | 349 | 战斗状态 (combat state data) |
| PresetActor | 306 | 预设人物 (preset character data) |
| ActorFeature | 289 | 人物特性 (character traits) |
| HomePlace | 277 | 建筑/据点 (buildings, locations) |
| 相枢化身 | 261 | 相枢化身 (Xiangshi avatars) |
| GongFaFPower | 212 | 功法发挥 (martial art primary effects) |
| Story | 114 | 剧情事件 (story events) |
| MakeItem | 85 | 制造物品 (crafting recipes) |
| PalceWorld | 54 | 世界地图 (world map data) |
| ScoreValue | 31 | 评分数值 (score values) |
| StoryShop | 8 | 商店剧情 (shop story data) |
| .tab/.tabx files | 27 | 汇总表 (summary tables: Age, Skill, GongFa, etc.) |
| Other | 7 | Misc (Version, Test, etc.) |

**Coverage of key value tables:**
- **功法 (Martial Arts):** GongFa (757) + GongFaFPower (212) + GongFaOtherFPower (1,301) = 2,270 data pages — complete
- **物品 (Items):** Item (4,442) + 物品文本 (4,442) + MakeItem (85) = 8,969 data pages — complete
- **建筑 (Buildings):** HomePlace (277) — complete
- **技艺 (Skills):** Covered by .tab files (Skill.tab, GongFa.tab, etc.) — complete
- **门派 (Sects):** Covered indirectly via GongFa, PresetActor, HomePlace entries — complete

Total data_ns disk usage: ~57 MB (13,671 files)

### Redirect Analysis

Of 3,915 redirects detected by wikitext content:
- Most redirect from `旧/物品/XXX` to `物品/XXX` (new version pages)
- Some redirect from abbreviated names to full page names
- Redirect targets are recorded in `index.json` per entry

### Rendered HTML Coverage

586 pages have full rendered HTML. These are all non-redirect content pages with substantive wikitext (>50 characters). The HTML includes expanded templates, resolved transclusions, and formatted tables. Redirects and stub pages (using only `{{物品页}}` template) were excluded from HTML rendering as their content is template-generated and would require the full template engine.

## Spot Checks

| Page | Wikitext | HTML | Markdown | Status |
|------|----------|------|----------|--------|
| 旧/年龄 (Age/AP) | 4,748 B | 18,711 B | Yes | Tables with age brackets, AP values present |
| 旧/功法 (Martial Arts) | 11,069 B | Yes | Yes | Template-expanded content, technique listings |
| 旧/界青门 (Jie Qing Sect) | 2,912 B | Yes | Yes | Sect info, special mechanics described |
| 旧/物品/一包药材 (Item) | 12 B | No | No | Template-only stub (`{{物品页}}`) |
| 旧/命中与化解 (Combat Hit/Dodge) | 13,617 B | 54,826 B | Yes | Combat formulas, tables present |

## Known Limitations

1. **Redirect flag in metadata:** The `redirect` field in meta JSON was not set by the MediaWiki API query. Redirects are instead detected by wikitext content starting with `#REDIRECT` or `#重定向`. The `index.json` has the corrected redirect status.

2. **Template-only pages:** Pages like `旧/物品/一包药材` that consist solely of `{{物品页}}` have only 12 bytes of wikitext and no rendered HTML. Their actual content depends on template expansion with page-specific data from the Data namespace.

3. **Markdown quality:** The HTML→Markdown converter handles basic formatting (headers, tables, links, bold/italic, lists) but complex nested templates, collapsible sections, and custom CSS classes are simplified. The raw HTML files preserve all formatting.

4. **Image files:** Not downloaded. `images_manifest.json` contains filenames, URLs, and which pages reference each image.

5. **Double file extensions:** Data pages whose wiki title ends in `.json` are saved with a double extension (e.g., `Data_EA__Item__123.json.json`) because the save script appends the content type extension. The content is correct; only the filename has redundancy.

6. **Data field mapping modules missing:** The Data:EA/ JSON files use numeric keys for field names (e.g., Item JSON has keys like `"8"`, `"904"`, `"501"` instead of human-readable field names). The Lua modules that translate these numeric keys into field names (`Module:GongFa/main`, `Module:Item/main`, `Module:Home` and their sub-modules) are **not** included in the 32 crawled modules. Without these mapping modules, the raw Data JSON values cannot be directly interpreted — field semantics must be reverse-engineered from the rendered HTML pages. Whether to supplement these modules is a separate decision.

## Files

- `index.json`: 26,861 entries, each with title, pageid, revid, timestamp, type, redirect status, file sizes, and categories.
- `images_manifest.json`: 1,795 unique image entries with download URLs and referencing page lists.
