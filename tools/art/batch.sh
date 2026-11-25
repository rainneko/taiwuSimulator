#!/usr/bin/env bash
# 地区场景批量出图的一键流水线（M3-WO3 §7.6）。试点 6 张仍用 pilot.sh；这个脚本处理之后的各批。
#
# 用法：把这一批的原图按 artKey 命名放进 assets/art-source/region/<批次>/（原图存档，不进 git），然后
#     bash tools/art/batch.sh batch1
# 批次的 artKey 列表在 tools/art/batches/<批次>.txt。脚本对列表里的每一张：
#     复制到 art/region/raw/ → 按素材清单里的种类处理：
#         底纸（ground）      check_tile，另出 3×3 平铺图
#         立牌（standee）     key_alpha 抠像裁边、查底边与落影
#         地面散件（flat）    key_alpha --flat（不查底边）
# 然后出四张预览（近 / 中 / 远，外加一张全彩的中档），写到 art/region/review/<批次>/。
# 没出的图跳过，预览里用占位图补；任何一步报「错误」时脚本照常跑完，最后汇总。退出码 0 = 已有的图全部无错误。
# 批次列表里可以写一行「@preview <参数>」，这些参数会追加给每一张预览（例如房屋那一批写 @preview --houses --settlements 5）。
# 拼图出图：列表里「@sheet <拼图名> <列>x<行> <artKey>,…」一行一张；出图方存 <批次目录>/sheet.<拼图名>.png，
# 脚本先用 split_sheet.py 切到 <批次目录>/sheet-cut/，再照常逐张处理。同目录另有 <artKey>.png 时以单张为准（单独补出的）。
# 环境变量：TERRAINS 换预览用的地形（默认 plain,woods,mountain,lake,marsh）；PREVIEW=0 跳过预览，只做逐张检查。
set -u
cd "$(dirname "$0")/../.."

B=${1:-}
if [ -z "$B" ]; then echo "用法：bash tools/art/batch.sh <批次名>，例如 batch1" >&2; exit 2; fi
KEYS=tools/art/batches/$B.txt
if [ ! -f "$KEYS" ]; then echo "找不到批次列表 $KEYS" >&2; exit 2; fi

SRC=assets/art-source/region/$B
RAW=art/region/raw
REVIEW=art/region/review/$B
LIST=tools/art/region-assets.json
TERRAINS=${TERRAINS:-plain,woods,mountain,lake,marsh}
mkdir -p "$SRC" "$RAW" "$REVIEW"

# 列表里的 artKey → "artKey 种类"；清单里没有的 artKey 种类记为 unknown
#（macOS 自带的 bash 3.2 在 $(...) 里用 heredoc 不可靠，所以用 python3 -c）
pairs=$(python3 -c '
import json, sys
kinds = {it["artKey"]: it["kind"] for it in json.load(open(sys.argv[2], encoding="utf-8"))["items"]}
for line in open(sys.argv[1], encoding="utf-8"):
    k = line.split("#", 1)[0].strip()
    if k and not k.startswith("@"):
        print(k, kinds.get(k, "unknown"))
' "$KEYS" "$LIST") || { echo "读取批次列表失败" >&2; exit 2; }

# 「@preview ...」一行：追加给每张预览的参数（只取第一行；没有就是空）
EXTRA=$(sed -n 's/^@preview[[:space:]]*//p' "$KEYS" | head -1)

if grep -q '^@sheet' "$KEYS"; then
  echo "== 切拼图"
  python3 tools/art/split_sheet.py --batch "$KEYS" --src "$SRC" || fail_sheet=1
  echo
fi

total=0; have=0; missing=""; failed=""; fail=0
while read -r k kind; do
  [ -z "$k" ] && continue
  total=$((total + 1))
  f=""
  for ext in png webp jpg jpeg; do
    if [ -f "$SRC/$k.$ext" ]; then f="$SRC/$k.$ext"; break; fi
  done
  if [ -z "$f" ] && [ -f "$SRC/sheet-cut/$k.png" ]; then f="$SRC/sheet-cut/$k.png"; fi
  if [ -z "$f" ]; then missing="$missing $k"; continue; fi
  have=$((have + 1))
  p="$RAW/$(basename "$f")"
  cp "$f" "$p"
  echo "== $k（$kind）"
  case "$kind" in
    ground)  python3 tools/art/check_tile.py --preview "$REVIEW" "$p" || { fail=1; failed="$failed $k"; } ;;
    standee) python3 tools/art/key_alpha.py "$p" || { fail=1; failed="$failed $k"; } ;;
    flat)    python3 tools/art/key_alpha.py --flat "$p" || { fail=1; failed="$failed $k"; } ;;
    *)       echo "  错误：清单里没有这个 artKey，或这个脚本不处理它的种类（$kind）"; fail=1; failed="$failed $k" ;;
  esac
done <<EOF
$pairs
EOF

[ "${fail_sheet:-0}" = "1" ] && { fail=1; failed="$failed （拼图切分，见上方）"; }

echo
pv() {  # 输出文件名在前，其余参数原样传给 preview_grid
  local out=$1; shift
  python3 tools/art/preview_grid.py --region 15 --terrains "$TERRAINS" --out "$REVIEW/$out" "$@" $EXTRA || fail=1
}
if [ "${PREVIEW:-1}" = "0" ]; then
  echo "== 跳过预览（PREVIEW=0）"
else
  echo "== 预览（地形：$TERRAINS${EXTRA:+；附加参数：$EXTRA}；没出的件用占位图；四张共约 5 分钟，只想查单张图时加 PREVIEW=0 跳过）"
  pv near.png --zoom near --sight 1
  pv mid.png  --zoom mid  --sight 1
  pv far.png  --zoom far  --sight 1
  pv mid-color.png --zoom mid --sight 5
fi

echo
echo "本批 $total 张，已出 $have 张。"
[ -n "$missing" ] && echo "还没出（预览里用了占位）：$missing"
[ -n "$failed" ] && echo "有错误、需要重出或补救：$failed"
echo "预览与 3×3 平铺图在 $REVIEW/"
if [ $fail -eq 0 ]; then echo "已有的图全部无错误"; else echo "有步骤报错，见上方「错误」条目"; fi
exit $fail
