#!/usr/bin/env bash
# 青绿 A/B 的一键流水线（docs/art-prompts/region-ab.md）。
#
# 用法：把按新风格重出的图按 artKey 命名放进 assets/art-source/region/ab/，然后
#     bash tools/art/ab.sh
# 这三张和现有图同名，所以全部走自己的目录，**不碰** art/region/raw/ 与 art/region/work/：
#     原图 → art/region/ab/raw/ → key_alpha 抠像裁边 → art/region/ab/work/
#     art/region/ab/work-merged/ = 现有 work/ 的全部图（符号链接）+ 这三张新图（覆盖同名）
# 然后出三列对比（现状 / 青绿：新图 + 其余图载入时调色 / 青绿 + 赭色岩层侧壁），近档、中档各一行，
# 拼成 art/region/review/ab/compare-qinglv.jpg。没出的图跳过（那一列仍用现有图调色）。
# 环境变量：SEED（默认 30：村庄旁边有山也有林）、PREVIEW=0 只做逐张检查。
set -u
cd "$(dirname "$0")/../.."

KEYS="terrain.standee.mountain.0 terrain.standee.woods.0 loc.village.0"
SRC=assets/art-source/region/ab
AB=art/region/ab
REVIEW=art/region/review/ab
SEED=${SEED:-30}
mkdir -p "$SRC" "$AB/raw" "$AB/work" "$REVIEW"

have=""; missing=""; fail=0
for k in $KEYS; do
  f=""
  for ext in png webp jpg jpeg; do
    if [ -f "$SRC/$k.$ext" ]; then f="$SRC/$k.$ext"; break; fi
  done
  if [ -z "$f" ]; then missing="$missing $k"; continue; fi
  have="$have $k"
  p="$AB/raw/$(basename "$f")"
  cp "$f" "$p"
  echo "== $k"
  python3 tools/art/key_alpha.py --out "$AB/work" "$p" || fail=1
done

# work-merged：现有 work/ 的链接 + 新图的副本（每次重建链接，新图覆盖同名）
python3 -c '
import shutil, sys
from pathlib import Path
work, ab, merged = Path("art/region/work"), Path(sys.argv[1]) / "work", Path(sys.argv[1]) / "work-merged"
merged.mkdir(parents=True, exist_ok=True)
for f in merged.iterdir():
    if f.is_symlink() or f.is_file():
        f.unlink()
for f in work.iterdir():
    if f.is_file() and not (ab / f.name).is_file():
        (merged / f.name).symlink_to(f.resolve())
for f in ab.iterdir():
    if f.is_file():
        shutil.copy2(f, merged / f.name)
' "$AB" || fail=1

if [ "${PREVIEW:-1}" = "0" ]; then
  echo "== 跳过预览（PREVIEW=0）"
else
  SKIP=$(echo $have | tr ' ' ',')
  pv() {  # 输出文件名在前，其余参数原样传给 preview_grid
    local out=$1; shift
    python3 tools/art/preview_grid.py --region 15 --seed "$SEED" --out "$REVIEW/$out" "$@" >/dev/null || fail=1
  }
  echo "== 预览（seed $SEED；新图：${have:- 无}；六张并行，约 3 分钟）"
  for z in near mid; do
    s=1; [ $z = mid ] && s=3
    pv $z-a.png --zoom $z --sight $s &
    pv $z-b.png --zoom $z --sight $s --src "$AB/work-merged" --grade qinglv ${SKIP:+--grade-skip $SKIP} &
    pv $z-c.png --zoom $z --sight $s --src "$AB/work-merged" --grade qinglv ${SKIP:+--grade-skip $SKIP} --cliff-walls &
  done
  wait
  python3 tools/art/ab_sheet.py "$REVIEW" "${have:- 无}" || fail=1
fi

echo
echo "新图：${have:- 无}"
[ -n "$missing" ] && echo "还没出（青绿列里这几张仍用现有图调色）：$missing"
echo "对比图：$REVIEW/compare-qinglv.jpg"
if [ $fail -eq 0 ]; then echo "全部无错误"; else echo "有步骤报错，见上方「错误」条目"; fi
exit $fail
