#!/usr/bin/env bash
# 地区场景 6 张试点图的一键流水线（M3-WO3 §7；总监 2026-11-24 指定的 6 张）。
#
# 用法：把 GPT 出的原图按 artKey 命名放进 assets/art-source/region/trial/（原图备份，不进 git），然后
#     bash tools/art/pilot.sh
# 它会：复制到 art/region/raw/ → 抠像裁边（立牌、道路）→ 底纸平铺检查（另出 3×3 平铺图）→ 近 / 中 / 远三档预览，
#       外加近档 768² 与 1024² 底纸的对比图。全部输出在 art/region/work/ 与 art/region/review/。
# 不加 python3 -I：-I 会把脚本目录移出 sys.path，工具之间互相 import 会失败（-I 是给不可信的下载文件用的）。
# 缺哪张就跳过哪张，预览里用占位图补；任何一步报「错误」时脚本照常跑完，最后汇总。
set -u
cd "$(dirname "$0")/../.."

TRIAL=assets/art-source/region/trial
RAW=art/region/raw
REVIEW=art/region/review
GROUNDS="terrain.ground.plain terrain.ground.woods"
STANDEES="terrain.standee.woods.0 terrain.standee.mountain.0 loc.village.0"
ROAD="region.road"
mkdir -p "$TRIAL" "$RAW" "$REVIEW"

missing=()
p=""
found() {  # 在 TRIAL 里找 artKey 对应的图并复制到 RAW；找到时把 RAW 里的路径放进 $p
  local k=$1 f
  p=""
  for ext in png webp jpg jpeg; do
    f="$TRIAL/$k.$ext"
    if [ -f "$f" ]; then cp "$f" "$RAW/$k.$ext"; p="$RAW/$k.$ext"; return 0; fi
  done
  missing+=("$k"); return 1
}

fail=0
echo "== 1. 立牌抠像裁边（key_alpha）"
for k in $STANDEES; do
  found "$k" && { python3 tools/art/key_alpha.py "$p" || fail=1; }
done
echo "== 2. 道路纸带（key_alpha --strip，查左右平铺）"
if found "$ROAD"; then
  python3 tools/art/key_alpha.py --strip "$p" || fail=1
  python3 tools/art/check_tile.py --strip --no-chroma "$p" || fail=1
fi
echo "== 3. 底纸平铺检查（check_tile，3×3 平铺图写到 $REVIEW）"
for k in $GROUNDS; do
  found "$k" && { python3 tools/art/check_tile.py --preview "$REVIEW" "$p" || fail=1; }
done
echo "== 4. 三档预览（preview_grid；没出的件用占位图）"
for z in near mid far; do
  python3 tools/art/preview_grid.py --zoom "$z" --sight 1 --region 15 --terrains plain,woods,mountain || fail=1
done
python3 tools/art/preview_grid.py --zoom near --sight 1 --region 15 --terrains plain,woods,mountain --ground-px 1024 || fail=1
# v1.3：地形纸层默认开着；再出一张聚居格换成折纸房屋（部件还没出图，用占位贴图）的近档，看房子与真实立牌、底纸的比例
python3 tools/art/preview_grid.py --zoom near --sight 1 --region 15 --terrains plain,woods,mountain --houses || fail=1

echo
[ ${#missing[@]} -gt 0 ] && echo "缺图（预览里用了占位）：${missing[*]}"
echo "预览：$REVIEW/preview-near-s1.png、preview-mid-s1.png、preview-far-s1.png、preview-near-s1-g1024.png、preview-near-s1-houses.png"
[ $fail -eq 0 ] && echo "全部步骤无错误" || echo "有步骤报错，见上方「错误」条目；按工单 §2.5 重出对应的图"
exit $fail
