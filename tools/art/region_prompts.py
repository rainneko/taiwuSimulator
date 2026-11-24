#!/usr/bin/env python3
"""地区场景美术素材的 prompt 生成器与素材清单（M3-WO3 §1–§4）。

素材清单是这里的数据表；运行后把每一项展开成可直接粘贴的完整 prompt，
写到 docs/art-prompts/region.md，同时写出供后处理工具链读取的清单 tools/art/region-assets.json。
改需求就改这里的表，然后重新生成，不要手改输出文件。

用法：
    python3 tools/art/region_prompts.py                  # 生成 docs/art-prompts/region.md 与 tools/art/region-assets.json
    python3 tools/art/region_prompts.py --slots FILE     # 追加内容包提供的专属地点槽位（JSON，见 M3-WO3 §5）
    python3 tools/art/region_prompts.py --check          # 只校验（键唯一、分类数量与清单一致、措辞检查），不写文件
    python3 tools/art/region_prompts.py --archetypes     # 打印专属地点可选的建筑原型清单
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "art-prompts" / "region.md"
LIST_OUT = ROOT / "tools" / "art" / "region-assets.json"

# 工单 §1 的分类数量；改表时同步改这里和工单
EXPECTED_COUNTS = {"A": 18, "B": 34, "C": 11, "D": 5, "E": 6, "F": 5, "H": 17, "I": 10}

# 图集 id（相对内容包的 art/ 目录，不带扩展名）与入库像素密度（每 1 格宽的像素数）
ATLAS_TERRAIN = "region/region-terrain"
ATLAS_LOCATIONS = "region/region-locations"
ATLAS_DETAIL = "region/region-detail"      # 填充小件 + 地面散件（v1.1）
PX_TERRAIN = 768          # 入库像素密度（px / 格）：近档约 640px / 格（工单 §1.2），立牌按物理尺寸约 1.2 倍
PX_LOCATIONS = 640
PX_SLOT = 768
ATLAS_SIZE = {ATLAS_TERRAIN: [4096, 2048], ATLAS_LOCATIONS: [4096, 2048], ATLAS_DETAIL: [2048, 1024], "province": [2048, 2048]}
GROUND_SIZE = 768          # 底纸数组每层边长（medium / low 档、开发期）；一层覆盖 2×2 格 → 384 texel / 格；长图 768×13824 < WebP 上限 16383
GROUND_SIZE_HIGH = 1024    # high 档（v1.2）：512 texel / 格；只出逐层文件并转 KTX2，不出长图（1024×18 超过 WebP 上限）

# ── 公共段落 ────────────────────────────────────────────────────────────────
# 80% 纸模立体（厚卡纸、纸芯切口、层间接触阴影、模切轮廓）+ 20% 水墨（宣纸纤维、局部淡墨点缀）。

STYLE = (
    "手工纸模（papercraft）风格的游戏美术素材。物体由多层厚卡纸裁切、叠贴而成："
    "看得出每层纸的厚度，切口露出一线白色纸芯，上下两层纸之间有一道细窄的接触阴影；"
    "造型概括，轮廓是干净利落的模切线。配色低饱和，以平涂为主，纸面带细微的宣纸纤维纹理；"
    "只在局部用少量淡墨晕染、点苔或枯笔皴擦作点缀（约占画面两成），不要大面积水墨渲染。"
    "淡墨只用来晕染和点苔，不要形成任何像文字、符号或印章的笔画。"
    "画面里没有任何文字、字母、数字、印章、签名、水印、边框，也没有人物和动物。"
)

LIGHT_KEY = "光从左上方来：每层纸的接触阴影落在它的右下侧，很窄、很实。"

LIGHT_FLAT = (
    "光线是均匀的漫射光，不偏向任何方向：纸层的接触阴影在四周均匀、很浅。"
    "（游戏会把这张图旋转、镜像后使用，带方向的光影会穿帮。）"
)

STANDEE = (
    "画面内容是一张立牌：一个物体（或一组紧挨着的物体）作为一整块剪影，完整入画，四周留出约 8% 的空白。"
    "视角是正面平视、略带俯角（约 15°），能看到屋顶或树冠的一点上表面；不要强烈的透视，不要从高空俯拍。"
    "按物体本来的比例画，不要竖向拉长，也不要压扁。"
    "主体最下缘是一条水平的直线切边，像纸板沿地面被裁平，可以直接立在桌面上；"
    "剪影的上半部轮廓要鲜明，缩小到 64 像素高时仍能一眼认出是什么。"
    "不要画地面、草皮、土坡、底座或圆盘，不要画任何落在地上的影子，也不要物体下方的暗色晕（影子由游戏实时生成）。"
    "剪影外缘不要额外描白边或黑边（白边由游戏生成）。"
    "背景完全透明；如果做不到透明，就用纯品红 #FF00FF 均匀平涂背景，主体里不要使用品红、洋红或亮紫色。"
    "不要用灰白棋盘格来表示透明。正方形画幅，1024×1024。"
)

GROUND = (
    "画面内容是一块地表纹理：从正上方垂直俯视（正射投影），没有透视、没有地平线、没有天空，"
    "铺满整个画面，上下、左右四边无缝衔接，可以无限平铺。"
    "画面里没有任何突出的单个物体或视觉中心，元素大小相近、均匀散布，"
    "单个元素（一团树冠、一块石头）约占画面宽度的 1/12 到 1/6；整张图对应游戏里 2×2 格的地面。"
    "整幅只有这一种地表：不要画岸线、水边、沙滩、田埂、小路、篱笆或任何边界线，也不要在画面一角混进别的地表"
    "——不同地表之间弯曲的交界、撕开的纸边和岸边的芦苇都由游戏生成。"
    "{rotation}"
    "没有投影，没有暗角，没有从一边到另一边的明暗渐变。"
    "颜色比真实地表更浅、更灰一些（游戏会在上面再按季节染色）；缩小到 64 像素见方时仍能认出是哪种地形。"
    "正方形画幅，1024×1024，不透明。"
)
ROT_FREE = "纹理不能有明显的方向性（游戏会把它随机旋转 90° 并镜像来打散重复）。"
ROT_FIXED = "行列的方向与画面上下边平行、横贯整幅，左右两端的行列要对得上；游戏不会旋转这张图，只会左右、上下翻转。"

STRIP = (
    "画面内容是一条横向长条：从正上方垂直俯视，没有透视；长条横贯整个画面宽度，"
    "左右两端无缝衔接、可以沿横向无限平铺，长条上下边缘之外是背景。"
    "背景完全透明；如果做不到透明，就用纯品红 #FF00FF 均匀平涂背景，长条本身不要用品红色。"
    "不要用灰白棋盘格来表示透明。画幅 1024×256（横长）。"
)

MASK_STRIP = (
    "这是一张给程序用的灰度遮罩，不是插画：只有黑、白和二者之间很窄的灰色过渡，"
    "不要任何颜色、纹样、纸纹、光影或文字。画幅 1024×256（横长），左右两端无缝衔接、可以沿横向平铺。"
)

DENSITY = (
    "这是一张给程序用的浓度图：只有黑白灰，不要任何彩色，不要文字。"
    "从正上方俯视，没有透视，没有方向性光影。四边无缝衔接、可以平铺。正方形画幅，1024×1024，不透明。"
)

FLAT_PIECE = (
    "画面内容是一个平放在桌面上的纸件，从正上方垂直俯视，没有透视。"
    "背景完全透明；如果做不到透明，就用纯品红 #FF00FF 均匀平涂背景，纸件本身不要用品红色。"
    "不要用灰白棋盘格来表示透明，不要画落影。正方形画幅，512×512。"
)

GROUND_PIECE = (
    "画面内容是一片平贴在地面上的薄纸件（游戏把它平放在格子的地面上，用来让每一格的地面各不相同）："
    "从正上方垂直俯视，没有透视；纸件轮廓不规则、像是从一张纸上撕下或剪下来的，四周留出约 8% 的空白。"
    "纸件很薄，只有一两层，层间接触阴影很浅；不要画落影，不要画周围的地面。"
    "背景完全透明；如果做不到透明，就用纯品红 #FF00FF 均匀平涂背景，纸件本身不要用品红色。"
    "不要用灰白棋盘格来表示透明。正方形画幅，1024×1024。"
)

# ── 数据表 ──────────────────────────────────────────────────────────────────
# 地形键与 PLAN §3.6 的 TerrainType 一一对应，顺序即底纸纹理数组的层号（见 build_ground_array.py）。
# 立牌：(描述, 立起后的高度[格], 宽高比 w/h)。宽度由出图裁边后的实际宽高比决定，这里的宽高比写进 prompt 并供校验。
# 高度 0.45–0.65（v1.1：用户给的「九格」示意里，一格是一个小场景，树约半格高；图按物体本来的比例画）。

TERRAINS = [
    # key, 标签, 底纸描述, 主色, noRotate, 植被(随季节染色), [立牌 A, 立牌 B]
    ("plain", "原野",
     "低矮的草甸：短草用一簇簇小片叠纸表示，均匀铺开，草簇之间零星几笔淡墨草叶和极小的白色花点", "灰绿", False, True,
     [("几株高低不齐的野草，细长的叠纸草叶向外弯垂，中间挺出两三根毛茸茸的草穗", 0.45, 0.9),
      ("一块圆润的卵石，半掩在三两朵小野花后面", 0.45, 1.2)]),
    ("lake", "湖泊",
     "平静的水面：两三层浅色纸叠出一道道舒缓的水纹弧线，弧线朝向各不相同、均匀散布，淡墨轻轻晕出深浅；整幅都是开阔的水面，看不到岸", "灰青蓝", False, False,
     [("一丛芦苇，十来根细秆，顶端是蓬松的浅色羽状穗，整体向一侧微弯", 0.55, 0.6),
      ("一只空的小木船，船头系在一根歪斜的木桩上；船身像是一张纸对折而成，船底沿水线裁平", 0.45, 1.6)]),
    ("farmland", "农田",
     "整齐的田垄：一垄一条细长纸带，垄与垄平行、横贯画面，垄间露出深一号的底纸，每垄上有一排均匀的小苗点", "黄绿与土黄", True, True,
     [("一个圆顶的草垛，草秆用细纸条层层叠出", 0.52, 1.0),
      ("田边一架木制水车：一个大木轮，轮缘一圈小木斗，旁边接着一段木槽", 0.58, 1.0)]),
    ("woods", "林地",
     "疏朗的林地：从正上方看去，一个个圆润的叠纸树冠均匀散布，树冠之间露出林下铺着落叶的地面", "中绿", False, True,
     [("一棵圆冠阔叶树：树冠由三四层由大到小的圆片叠成，树干笔直", 0.62, 0.8),
      ("两棵锥形的针叶树，一高一矮，树冠是一层层叠起的锯齿形纸片", 0.62, 0.75)]),
    ("jungle", "密林",
     "密林的树冠层：大小不一的叶团层层叠压，几乎不露地面，深浅不同的绿纸交错，叶团之间偶有一点深色空隙", "深墨绿", False, True,
     [("一棵高大的古树：宽阔的伞形树冠，树冠下垂着几条藤蔓和气根", 0.65, 0.9),
      ("一丛大叶植物：五六片宽大的长叶从根部向外舒展，叶片层层重叠", 0.52, 1.1)]),
    ("garden", "园林",
     "园林的铺地：均匀散布的一小团一小团修剪过的灌木，灌木之间是冰裂纹的碎石铺地", "青绿与米白", False, True,
     [("一棵修剪成三层圆团的造型松，枝干弯曲", 0.58, 0.85),
      ("一块瘦高的太湖石，石身布满玲珑的孔洞", 0.58, 0.6)]),
    ("mountain", "山岳",
     "山地的俯视：交错的折纸棱线把画面分成大小不一的多面块面，块面平涂，棱线处用淡墨皴擦", "青灰", False, False,
     [("三座前后错开的尖山峰，一层纸一座峰，前低后高", 0.65, 1.2),
      ("一座陡峭的孤峰，山腰横缠一条细长的白色纸云", 0.65, 0.7)]),
    ("cave", "洞穴",
     "布满孔洞的岩石地表：许多大小相近的深色小孔洞与裂隙均匀分布，每个洞口边缘是一圈圈向内凹陷的纸层", "灰褐与深灰", False, False,
     [("一个拱形岩洞口：外圈是粗糙的岩石，洞内是层层向后退的深色纸，越往里越黑", 0.55, 1.1),
      ("一段裂开的岩壁，中间一道深黑的竖向岩缝，缝口垂着几缕枯藤", 0.58, 0.8)]),
    ("stoneForest", "石林",
     "密集石柱的顶面：大小不一的多边形纸片紧挨着拼满画面，像一根根石柱的平顶，缝隙里是深色", "浅灰白", False, False,
     [("一组五六根高低不一的细长石柱，柱身有横向的层理", 0.65, 0.9),
      ("一根孤立的尖锥形石笋，顶端略弯", 0.62, 0.45)]),
    ("hill", "丘陵",
     "缓丘地表：许多小圆丘错落散布，每个圆丘是三四圈由浅到深的叠纸等高线，圆丘之间是平地", "黄绿灰", False, True,
     [("一个圆缓的土丘，丘顶并排两三棵小圆树", 0.52, 1.4),
      ("一段层层叠起的梯田缓坡，三四级弧形台阶", 0.48, 1.5)]),
    ("vale", "花谷",
     "花谷的草地：草地上均匀散落着小团开花矮树的树冠与飘落的花瓣，花是极小的浅色纸点", "柔粉与嫩绿", False, True,
     [("一棵开满浅粉色花的树，花团由许多小圆纸片堆成，枝干虬曲", 0.62, 0.95),
      ("一丛开花的矮灌木，花朵比叶子多", 0.45, 1.3)]),
    ("mulberry", "桑园",
     "成行的桑树：一行行低矮的圆树冠沿水平方向整齐排列、横贯画面，行距相等，行间是泥土小道", "橄榄绿", True, True,
     [("一棵低矮的桑树：主干粗短，枝头被剪成拳头状，冒出几簇宽大的心形叶", 0.52, 1.0),
      ("两三只叠放的圆竹筐，筐里堆满宽大的心形叶", 0.45, 1.2)]),
    ("canyon", "峡谷",
     "干裂的岩层地表：弯曲交错的深沟与岩脊，沟壁露出层层叠叠的纸边", "赭红灰", False, False,
     [("一段层状的岩壁：七八层深浅交替的纸横向叠起，顶部参差", 0.55, 1.3),
      ("一座风蚀的岩柱，上粗下细，顶上压着一块扁平的岩石", 0.62, 0.55)]),
    ("marsh", "沼泽",
     "沼泽：泥水与苔草斑驳相间，一个个小水洼用深色的光面纸，草丛用细纸条，均匀散布", "灰绿褐", False, True,
     [("几根顶着深褐色圆柱形穗的蒲草，叶片细长如剑", 0.52, 0.6),
      ("一截半浸在水里的朽木桩，桩顶长着几朵小蘑菇", 0.45, 0.8)]),
    ("herbGarden", "药园",
     "药圃：一块块小方畦拼成的格子，每畦种着叶形不同的矮草本，畦间是窄窄的土埂", "灰绿，少量淡紫点缀", False, True,
     [("一小畦草药，四周围着矮竹篱，中间几株开着淡紫色小花", 0.45, 1.3),
      ("一个竹制晾晒架，两根横杆上倒挂着几束草药", 0.55, 1.0)]),
    ("waste", "荒野",
     "荒野：贫瘠的砂土与碎石，稀疏的枯草，均匀散布", "灰黄", False, False,
     [("一棵枯树：枝杈光秃、扭曲伸展，没有一片叶子", 0.62, 0.9),
      ("一截倒伏的枯木横躺着，旁边几块风化的碎石", 0.45, 1.6)]),
    ("abyss", "暗渊",
     "破碎的黑色岩面：许多不规则的小裂口向下塌陷，裂口内是一层层更深的纸，个别裂口边缘透出一线冷蓝色微光", "墨黑与暗蓝", False, False,
     [("几根歪斜的黑色尖岩，像从地下刺出来", 0.62, 0.9),
      ("一块裂成两半的黑色巨石，裂缝里透出一线冷蓝色微光", 0.52, 1.1)]),
]

# 自然地形每格的立牌张数 [min, max]（工单 §3.6）。v1.1 格子放大到 4 倍面积后按用户要求加密：
# 林木类一格 4–7 张，开阔地形仍可 0 张；任何地形不超过 7 张（槽位上限，工单 §3.6）。
CELL_DENSITY = {
    "lake": (0, 1), "farmland": (0, 1),
    "plain": (0, 2), "waste": (1, 2), "cave": (1, 2), "canyon": (1, 2), "abyss": (1, 2), "herbGarden": (1, 2),
    "hill": (1, 3), "marsh": (1, 3),
    "mountain": (2, 3),
    "garden": (2, 4), "vale": (2, 4), "stoneForest": (2, 4), "mulberry": (3, 4),
    "woods": (4, 6),
    "jungle": (5, 7),
}
MAX_PER_CELL = 7

# 填充小件（v1.1，工单 §1.5）：各地形共用的低矮立牌，按地形取池、每格撒若干张，运行时按地形 / 季节染色。
# 一格的画面 = 主体立牌（B）+ 填充小件（H）+ 地面散件（I）三层；格子放大后靠它们让每一格都有细节、各不相同。
FILLERS = [
    # 键, 标签, 描述, 高, 宽高比, 随季节染色
    ("bush.0", "圆灌木", "一丛圆润的矮灌木，叶团由三四层大小不一的圆纸片叠成", 0.21, 1.4, True),
    ("bush.1", "开花灌木", "一丛矮灌木，枝头点缀着几朵浅色小花", 0.2, 1.5, True),
    ("fern", "蕨丛", "一丛蕨类，七八片羽状长叶从根部向两侧弯垂", 0.2, 1.6, True),
    ("tuft.0", "草簇", "一簇细长的野草，草叶参差，向两侧微弯", 0.14, 1.3, True),
    ("tuft.1", "草穗", "几根挺直的草茎顶着毛茸茸的草穗，夹着几片细叶", 0.2, 0.9, True),
    ("reeds", "芦苇丛", "一小丛芦苇，七八根细秆顶着浅色的羽状穗", 0.26, 0.7, True),
    ("flowers.0", "浅色野花", "一小簇低矮的野花，白色与浅黄色的小圆花片夹着几片小叶", 0.12, 1.6, True),
    ("flowers.1", "深色野花", "一小簇低矮的野花，淡紫与浅红色的小花夹着几片小叶", 0.13, 1.5, True),
    ("rock.0", "卵石", "一大一小两块圆润的灰色卵石，前后挨着", 0.12, 1.6, False),
    ("rock.1", "棱石", "一块棱角分明的岩石，顶面略平，表面几笔淡墨皴擦", 0.16, 1.3, False),
    ("mushrooms", "蘑菇", "三四朵高矮不一的小蘑菇，伞盖浅褐色", 0.1, 1.3, False),
    ("stump", "树桩", "一截锯平的矮树桩，顶面露出一圈圈年轮，根部向两侧伸出几条短根", 0.13, 1.4, False),
    ("log", "倒木", "一截横躺的倒木，树皮粗糙，一端断口参差，上面长着一小片苔藓", 0.12, 2.6, False),
    ("deadwood", "枯枝丛", "一丛干枯的矮灌木，细枝光秃、交错伸展", 0.2, 1.3, False),
    ("thorn", "荆棘", "一丛带刺的低矮荆棘，枝条弯曲，挂着几颗小红果", 0.17, 1.4, True),
    ("bamboo", "嫩竹", "几株高低不齐的嫩竹，竹竿细直，顶端几片窄叶", 0.29, 0.6, True),
    ("herbs", "草药丛", "几株叶形各异的矮草本，其中一株开着淡紫色小花", 0.14, 1.3, True),
]

# 地面散件（v1.1，工单 §1.5）：平贴在地面上的薄纸件，按地形取池、随机旋转后贴在格内。(键, 标签, 描述, 边长[格])
GROUND_PIECES = [
    ("dirt", "泥土斑", "一片不规则的裸露泥土，土黄偏灰，上面几粒小石子", 0.45),
    ("leaves", "落叶", "一小片散落的落叶：十几片大小不一的叶形纸片交叠，黄褐与暗绿相间", 0.38),
    ("moss", "苔藓", "一片不规则的苔藓，由几种深浅的绿色细碎纸屑堆成", 0.38),
    ("pebbles", "碎石", "一小片散落的碎石：七八块大小不一的扁平灰色石片", 0.34),
    ("petals", "花瓣", "一片散落的浅粉色花瓣，二十来片小花瓣疏密不均", 0.38),
    ("puddle", "水洼", "一个不规则的小水洼：水面是浅灰青色的光面纸，边缘一圈深色湿泥", 0.38),
    ("roots", "盘根", "几条从一点向外伸展的扁平树根，像贴在地上的褐色纸条", 0.41),
    ("cracks", "龟裂", "一片干裂的土块，几道交错的细裂缝把它分成大小不一的块面", 0.45),
    ("needles", "松针", "一片散落的细长松针，夹着两三颗小松果", 0.34),
    ("grass", "深草斑", "一片颜色深一号的茂密短草，边缘参差", 0.45),
]

# 每种地形的填充池与每格张数，地面散件池与每格张数（工单 §3.6）
DETAIL_POOLS = {
    # 地形: ((填充小件…), (填充 min, max), (地面散件…), (散件 min, max))
    "plain": (("tuft.0", "tuft.1", "flowers.0", "flowers.1", "bush.0", "rock.0"), (4, 7), ("grass", "dirt", "pebbles"), (1, 2)),
    "lake": (("reeds", "rock.0"), (2, 4), (), (0, 0)),
    "farmland": (("tuft.0", "flowers.0"), (1, 3), ("dirt",), (0, 1)),
    "woods": (("bush.0", "fern", "mushrooms", "stump", "tuft.0", "flowers.0"), (4, 7), ("leaves", "moss", "roots", "needles"), (1, 3)),
    "jungle": (("fern", "bush.0", "mushrooms", "log", "bamboo"), (4, 7), ("leaves", "moss", "roots"), (2, 3)),
    "garden": (("bush.0", "bush.1", "rock.1", "flowers.0", "bamboo"), (3, 5), ("pebbles", "petals"), (1, 2)),
    "mountain": (("rock.1", "rock.0", "tuft.1", "thorn"), (3, 5), ("pebbles", "cracks"), (1, 2)),
    "cave": (("rock.1", "mushrooms", "deadwood"), (2, 4), ("pebbles", "puddle"), (1, 2)),
    "stoneForest": (("rock.1", "rock.0", "tuft.0"), (2, 4), ("pebbles",), (1, 2)),
    "hill": (("bush.0", "tuft.0", "tuft.1", "flowers.1", "rock.0"), (4, 6), ("grass", "dirt"), (1, 2)),
    "vale": (("flowers.0", "flowers.1", "bush.1", "tuft.0"), (5, 8), ("petals", "grass"), (2, 3)),
    "mulberry": (("tuft.0", "bush.0", "flowers.0"), (2, 4), ("leaves", "dirt"), (1, 2)),
    "canyon": (("rock.1", "deadwood", "thorn"), (2, 4), ("cracks", "pebbles"), (1, 2)),
    "marsh": (("reeds", "tuft.1", "log", "mushrooms"), (4, 6), ("puddle", "moss"), (2, 3)),
    "herbGarden": (("herbs", "flowers.1", "tuft.0"), (3, 5), ("dirt",), (1, 1)),
    "waste": (("deadwood", "rock.0", "rock.1", "thorn", "tuft.1"), (3, 5), ("cracks", "dirt", "pebbles"), (1, 3)),
    "abyss": (("rock.1", "deadwood"), (2, 3), ("cracks",), (1, 2)),
    "settlement": ((), (0, 0), ("dirt", "pebbles"), (1, 2)),
}
MAX_FILLERS, MAX_PIECES = 8, 3

# 水面与岸边（v1.1「有机交界」，工单 §3.2.3、§3.6）：交界本身弯曲（着色器里扭曲查格坐标），
# 水面一侧沿岸一道浅水带；水面上的填充小件只长在离岸 band 格以内，陆地一侧沿岸再补几株岸边件。
WATER_TERRAINS = ("lake",)
SHORE = (("reeds", "rock.0", "tuft.1"), (1, 3), 0.12)     # (岸边件, 陆地每格张数, 岸带宽[格])

# 试点批次（工单 §7）：先出这 6 张，定下密度与风格基准后再批量出其余的
PILOT = ("terrain.ground.plain", "terrain.ground.mountain", "terrain.standee.woods.0",
         "terrain.standee.mountain.0", "loc.village.0", "region.road", "filler.bush.0", "ground.piece.leaves")

# 聚居类地块（city / sectSeat / town / fort / village）共用一张地基底纸，层号 17
SETTLEMENT_GROUND = ("settlement", "聚居地基", "聚居地的铺地：夯土地面上铺着规则的石板，拼缝整齐，偶有几处磨损和小草", "暖灰", False)

# 地点立牌的类别规格：(立起后的宽, 高)[格]、辨识要点（写进 prompt，保证同类之间、类别之间缩小后可分）
LOC_KIND = {
    "city": ((1.3, 1.15), "这是一座城池：要能看出灰砖城墙或城门，屋顶是青灰色的瓦。"),
    "sectSeat": ((1.3, 1.2), "这是一处门派驻地：要能看出山门或层层升高的殿阁，殿顶有少量朱红点缀。"),
    "town": ((1.05, 0.9), "这是一座没有城墙的小镇：木构房屋、灰瓦屋顶，比城池朴素。"),
    "fort": ((1.05, 0.9), "这是一座山寨：原木或粗石垒成，看起来粗犷、带防御。"),
    "village": ((1.0, 0.75), "这是一个小村庄：茅草或土墙，矮小朴素。"),
}

LOCATIONS = [
    # artKey, 类别, 标签, 描述
    ("loc.city.default.0", "city", "城市（通用 1）",
     "一座城池的正面：前层是灰砖城墙，墙头有整齐的垛口，正中一座拱形城门，城门上方是重檐城楼；中层是几重青灰瓦顶；后层是一座高出众屋的楼阁"),
    ("loc.city.default.1", "city", "城市（通用 2）",
     "一座临水的城池：最前面是一窄条水面和石砌码头，码头旁一道拱形水门，水门前泊着两只空船；中层是沿岸错落的青瓦屋舍；后层是带垛口的城墙与一座城楼"),
    ("loc.sectSeat.default.0", "sectSeat", "门派驻地（通用 1）",
     "依山而建的院落群：最前是一座石砌山门，一道长石阶向上，几重殿阁沿山势层层升高，最后一层贴着山形的轮廓"),
    ("loc.sectSeat.default.1", "sectSeat", "门派驻地（通用 2）",
     "平地上的大型院落：前有一座方形高台，台前一对素色旗面的旗杆；中间是重檐的正殿；两侧是左右对称的厢房与回廊"),
    ("loc.town.0", "town", "小镇 1",
     "一条小街：三四栋二层木楼并排，屋檐高低前后错落，楼前挑出几盏素面灯笼"),
    ("loc.town.1", "town", "小镇 2",
     "集镇的入口：一座三开间的木牌坊，横梁是素面木条，牌坊后面露出几片高低错落的屋顶"),
    ("loc.fort.0", "fort", "寨子 1",
     "木栅山寨：前层是一圈削尖的原木栅栏与一道木寨门，后层是一座高高的木瞭望塔"),
    ("loc.fort.1", "fort", "寨子 2",
     "石寨：前层是粗石块垒成的寨墙与低矮的寨门，墙后露出几间棚屋的斜顶"),
    ("loc.village.0", "village", "村庄 1",
     "两三间茅草顶的小屋，前面一道竹篱笆"),
    ("loc.village.1", "village", "村庄 2",
     "农家小院：一间土墙瓦屋，院里一口带辘轳的水井和一片晒场"),
    ("loc.village.2", "village", "村庄 3",
     "山脚下的几间土屋，屋后一棵枝叶繁茂的大树"),
]

POI_SIZE = (0.65, 0.65)
POIS = [
    ("poi.station", "驿站", "路边的驿站：一间小屋连着一个草棚，棚前一根拴马桩和一只饮水槽"),
    ("poi.ruin", "废墟", "一处废墟：坍塌的残墙和两根断柱，缝里长着杂草"),
    ("poi.marker.cave", "奇遇标记：洞口", "一个被藤蔓半掩的小洞口，洞里透出一点暖色的微光"),
    ("poi.marker.stele", "奇遇标记：石碑", "一块表面风化光滑的旧石碑，斜立在乱草里，碑顶长着青苔"),
    ("poi.marker.pavilion", "奇遇标记：孤亭", "一座四柱小亭，亭顶翘角，亭中空无一物"),
]

PROPS = [
    # artKey, 标签, 描述, 高, 宽高比
    ("loc.prop.wall", "前景件：矮墙", "一段低矮的夯土墙，墙头覆一排青瓦", 0.23, 2.4),
    ("loc.prop.lantern", "前景件：石灯", "一座石灯：方形灯座、镂空的灯室和攒尖的小石顶", 0.29, 0.45),
    ("loc.prop.poles", "前景件：旗杆", "一对竖立的旗杆，素色旗面微微飘起", 0.33, 0.7),
    ("loc.prop.tree", "前景件：路边树", "一棵树干歪斜的路边老树，树冠不大", 0.33, 0.9),
    ("loc.prop.fence", "前景件：木栅", "一段木栅栏，五六根木桩用两道横木连起", 0.2, 2.4),
    ("loc.prop.steps", "前景件：石阶", "一段三五级的宽石阶，两侧有矮石栏", 0.2, 1.8),
]

DECOR = [
    # artKey, 标签, 尺寸说明, 风格段, 公共约束, 描述, 后处理模式, 入库尺寸
    ("region.road", "道路纸带", "1024×256，左右可平铺，透明底", STYLE + LIGHT_FLAT, STRIP,
     "一条窄窄的乡间小土路：一条裁出来的土黄色窄纸带横贯画面，带宽约占画面高度的六成，中间一道浅浅的踩出来的压痕，"
     "两侧边缘略不规则、露出一线白色纸芯", "strip-rgba", (512, 128)),
    ("region.fog", "未探索迷雾（浓度图）", "1024×1024，可平铺，灰度", "", DENSITY,
     "纯黑背景上的米白色云团，白表示云最厚，黑表示没有云。云团由三四层边缘柔和的薄纸叠成，每层边缘是轻微撕开的毛边，"
     "层与层之间像水墨在宣纸上晕开一样柔和过渡；云团大小不一、均匀散布，云团之间的黑色空隙约占三成", "gray-tile", (512, 512)),
    ("region.edge", "撕纸毛边遮罩", "1024×256，左右可平铺，灰度", "", MASK_STRIP,
     "上半部分纯白，下半部分纯黑，黑白分界线大致在正中、横贯画面，是手撕纸特有的不规则毛边："
     "起伏幅度约为画面高度的五分之一，边上带细小的纤维毛刺", "gray-strip", (512, 128)),
    ("region.frame.edge", "地图边框条", "1024×256，左右可平铺，透明底", STYLE + LIGHT_KEY, STRIP,
     "一条厚卡纸边条：两层纸叠贴，上层比下层窄，表面有一行简单的几何回纹压痕（压凹，不上色）；边条约占画面高度的七成",
     "strip-rgba", (512, 128)),
    ("region.frame.corner", "地图边框角", "512×512，透明底", STYLE + LIGHT_KEY, FLAT_PIECE,
     "与边框条配套的直角转角件：两层厚卡纸叠成 L 形，两臂宽度与边框条一致，转角处一个简单的如意形镂空",
     "flat-rgba", (256, 256)),
]

# ── 专属地点槽位 ────────────────────────────────────────────────────────────
# 槽位表由内容包负责人填写（见工单 §5）；这里只给模板与建筑原型的通用备选清单。

SLOT_FIELDS = ("artKey", "archetype", "setting", "color", "accent", "feature")
SLOT_KEY_RE = re.compile(r"^loc\.(city|sectSeat)\.(?!default\.)[A-Za-z0-9_-]+$")
SLOT_GROUP_RE = re.compile(r"^[A-Za-z0-9_-]+$")

ARCHETYPES = [
    # id, 名称, 适用, 通用描述（可直接作为 archetype 字段，或在此基础上改写）
    ("walledGate", "城墙城门楼", "city", "灰砖城墙环绕的城池，正中是拱形城门与重檐城楼"),
    ("waterTownPier", "水乡码头", "city", "河道穿城的水乡，前有石砌码头与拱形水门，屋舍临水而建"),
    ("bridgeTown", "跨河桥城", "city", "一座大石拱桥横跨河面，两岸屋舍沿桥头展开"),
    ("terracedHillTown", "层叠山城", "city", "依坡而建的山城，屋顶一层压一层向上叠去，坡顶一座城楼"),
    ("frontierEarthFort", "边塞土堡", "city", "夯土高墙围成的方形堡城，墙角有敌台，城内屋顶低平"),
    ("summitHalls", "山巅殿阁", "sectSeat", "峰顶的殿阁群，石阶从山门一路盘上峰顶"),
    ("cliffGallery", "悬崖栈阁", "sectSeat", "嵌在峭壁上的楼阁，木栈道沿崖壁连通各层"),
    ("grottoTemple", "石窟寺院", "sectSeat", "崖壁上开凿的一排石窟，窟前是木构檐廊与殿堂"),
    ("snowRidgeTemple", "雪岭石寺", "sectSeat", "积雪山岭上的石砌寺院，厚墙小窗，屋顶平缓"),
    ("bambooCourtyard", "竹林院落", "both", "竹林环抱的几进院落，白墙灰瓦，院墙随竹林曲折"),
    ("lakeIslePavilion", "湖心楼阁", "both", "湖心小岛上的楼阁，一道曲桥连向岸边"),
    ("terraceTower", "高台楼观", "both", "夯土高台上的多层楼观，台下有坡道与台阶"),
    ("forestTimberHold", "林间木寨", "both", "密林里的原木建筑群，高架木楼与吊脚回廊相连"),
    ("gardenEstate", "园林庭院", "both", "亭台、回廊、假山与池水组成的园林宅邸"),
    ("pagodaCompound", "塔院", "both", "院落中央一座多层宝塔，四周是殿堂与围墙"),
]

# ── 措辞检查 ────────────────────────────────────────────────────────────────
# 内容描述（不含公共段）里出现这些词，容易让模型画出文字、落影或地面，或者混进人物。

BANNED_ALL = ("字", "匾", "招牌", "题词", "印章", "落款", "影子", "投影", "倒影", "人物", "行人", "品红", "洋红")
BANNED_GROUND = ("一座", "一棵", "一个", "一块", "中央", "中心", "正中")
BANNED_STANDEE = ("地面", "草地", "底座")


REDUP = re.compile(r"一(.)\1")   # 「一个个」「一块块」是叠词，表示「许多」，不算单个物体


def lint(text: str, banned: tuple[str, ...]) -> list[str]:
    text = REDUP.sub("", text)
    return [w for w in banned if w in text]


# ── 展开 ────────────────────────────────────────────────────────────────────

def shape_phrase(aspect: float) -> str:
    if aspect >= 1.12:
        return f"整体剪影偏横宽，宽约为高的 {aspect:.1f} 倍。"
    if aspect <= 0.88:
        return f"整体剪影偏竖长，高约为宽的 {1 / aspect:.1f} 倍。"
    return "整体剪影接近方形。"


def ground_prompt(label: str, desc: str, color: str, no_rotate: bool) -> str:
    common = GROUND.format(rotation=ROT_FIXED if no_rotate else ROT_FREE)
    return f"{STYLE}{LIGHT_FLAT}\n\n内容：「{label}」地形的地表——{desc}。主色：{color}。\n\n{common}"


def standee_prompt(desc: str, aspect: float, color: str | None = None, layered: bool = False, cue: str = "") -> str:
    extra = f"主色：{color}。" if color else ""
    depth = "整体分前、中、后三层纸，前层压着后层，层间能看到明显的厚度与接触阴影。" if layered else ""
    return f"{STYLE}{LIGHT_KEY}\n\n内容：{desc}。{extra}{cue}{depth}{shape_phrase(aspect)}\n\n{STANDEE}"


def slot_kind(slot: dict) -> str:
    m = SLOT_KEY_RE.match(slot.get("artKey", ""))
    return m.group(1) if m else "city"


def slot_prompt(slot: dict) -> str:
    kind = slot_kind(slot)
    (w, h), cue = LOC_KIND[kind]
    desc = (
        f"{slot['archetype']}，坐落在{slot['setting']}；"
        f"主色调为{slot['color']}，点缀色为{slot['accent']}（点缀色只用在少数构件上）；"
        f"画面里最醒目的一处构件是{slot['feature']}"
    )
    return standee_prompt(desc, w / h, layered=True, cue=cue)


def _pool(terrain: str) -> dict:
    fill, (flo, fhi), pieces, (plo, phi) = DETAIL_POOLS[terrain]
    return {"fillers": [f"filler.{k}" for k in fill], "fillerCount": [flo, fhi],
            "pieces": [f"ground.piece.{k}" for k in pieces], "pieceCount": [plo, phi]}


def assets(slots: list[dict]) -> list[dict]:
    """素材清单（工具链的输入）。顺序 = prompt 编号顺序。"""
    items: list[dict] = []
    for layer, (key, label, _d, _c, no_rot, _s, _st) in enumerate(TERRAINS):
        items.append({"artKey": f"terrain.ground.{key}", "section": "A", "label": f"底纸：{label}",
                      "kind": "ground", "layer": layer, "terrain": key, "noRotate": no_rot, "layerSize": GROUND_SIZE, "layerSizeHigh": GROUND_SIZE_HIGH,
                      "density": list(CELL_DENSITY[key]), "fillers": _pool(key)})
        if key in WATER_TERRAINS:
            items[-1]["water"] = True
            items[-1]["shore"] = {"fillers": [f"filler.{k}" for k in SHORE[0]], "count": list(SHORE[1]), "band": SHORE[2]}
    k, label, _d, _c, no_rot = SETTLEMENT_GROUND
    items.append({"artKey": f"terrain.ground.{k}", "section": "A", "label": f"底纸：{label}",
                  "kind": "ground", "layer": len(TERRAINS), "terrain": k, "noRotate": no_rot, "layerSize": GROUND_SIZE, "layerSizeHigh": GROUND_SIZE_HIGH,
                  "density": [0, 0], "fillers": _pool(k)})
    for key, label, _d, _c, _n, seasonal, standees in TERRAINS:
        for i, (_desc, h, a) in enumerate(standees):
            items.append({"artKey": f"terrain.standee.{key}.{i}", "section": "B", "label": f"立牌：{label} {'AB'[i]}",
                          "kind": "standee", "atlas": ATLAS_TERRAIN, "atlasSize": ATLAS_SIZE[ATLAS_TERRAIN], "pxPerUnit": PX_TERRAIN, "terrain": key,
                          "height": h, "aspect": a, "anchor": [0.5, 0.0], "seasonal": seasonal})
    for key, kind, label, _desc in LOCATIONS:
        (w, h), _cue = LOC_KIND[kind]
        items.append({"artKey": key, "section": "C", "label": label, "kind": "standee", "atlas": ATLAS_LOCATIONS, "atlasSize": ATLAS_SIZE[ATLAS_LOCATIONS], "locKind": kind,
                      "pxPerUnit": PX_LOCATIONS, "height": h, "aspect": round(w / h, 3), "anchor": [0.5, 0.0]})
    for key, label, _desc in POIS:
        w, h = POI_SIZE
        items.append({"artKey": key, "section": "D", "label": label, "kind": "standee", "atlas": ATLAS_LOCATIONS, "atlasSize": ATLAS_SIZE[ATLAS_LOCATIONS],
                      "pxPerUnit": PX_LOCATIONS, "height": h, "aspect": round(w / h, 3), "anchor": [0.5, 0.0]})
    for key, label, _desc, h, a in PROPS:
        items.append({"artKey": key, "section": "E", "label": label, "kind": "standee", "atlas": ATLAS_TERRAIN, "atlasSize": ATLAS_SIZE[ATLAS_TERRAIN],
                      "pxPerUnit": PX_TERRAIN, "height": h, "aspect": a, "anchor": [0.5, 0.0], "seasonal": key == "loc.prop.tree"})
    for key, label, _size, _style, _common, _desc, mode, out in DECOR:
        items.append({"artKey": key, "section": "F", "label": label, "kind": "decor", "mode": mode, "out": list(out)})
    for key, label, _desc, h, a, seasonal in FILLERS:
        items.append({"artKey": f"filler.{key}", "section": "H", "label": f"填充小件：{label}", "kind": "standee",
                      "atlas": ATLAS_DETAIL, "atlasSize": ATLAS_SIZE[ATLAS_DETAIL], "pxPerUnit": PX_TERRAIN,
                      "height": h, "aspect": a, "anchor": [0.5, 0.0], "seasonal": seasonal})
    for key, label, _desc, size in GROUND_PIECES:
        items.append({"artKey": f"ground.piece.{key}", "section": "I", "label": f"地面散件：{label}", "kind": "flat",
                      "atlas": ATLAS_DETAIL, "atlasSize": ATLAS_SIZE[ATLAS_DETAIL], "pxPerUnit": PX_TERRAIN,
                      "height": size, "aspect": 1.0, "anchor": [0.5, 0.5]})
    for it in items:
        if it["artKey"] in PILOT:
            it["pilot"] = True
    for s in slots:
        kind = slot_kind(s)
        (w, h), _cue = LOC_KIND[kind]
        group = s.get("group", "_ungrouped")
        items.append({"artKey": s["artKey"], "section": "G", "label": f"专属地点：{s['artKey']}", "kind": "standee",
                      "atlas": f"region/province/{group}", "atlasSize": ATLAS_SIZE["province"], "pxPerUnit": PX_SLOT, "height": h,
                      "aspect": round(w / h, 3), "anchor": [0.5, 0.0]})
    return items


def build(slots: list[dict]) -> tuple[str, dict[str, int]]:
    out: list[str] = []
    counts: dict[str, int] = {}
    n = 0

    def item(section: str, key: str, label: str, size: str, prompt: str) -> None:
        nonlocal n
        n += 1
        counts[section] = counts.get(section, 0) + 1
        if key in PILOT:
            label = f"{label}【试点】"
        out.append(f"### {n}. {label}\n\n- artKey：`{key}`\n- 尺寸：{size}\n\n```\n{prompt}\n```\n")

    out.append("# 地区场景素材 Prompt（自动生成）\n")
    out.append("> 由 `tools/art/region_prompts.py` 生成，请勿手改；需求、规格与验收见 `docs/work-orders/M3-WO3-region-art-assets.md`。\n"
               "> 每个代码块是一条完整的 prompt，整块复制即可。全部为从零描述的原创设计。\n"
               "> **开对话时先定风格（用户 2026-11-24）**：先给 GPT 看 papertrails（https://github.com/xikhar/papertrails ，MIT）的链接和几张它的画面截图，说明目标是这种纸模立体书质感（纸有厚度、模切白边、层叠投影、低饱和）；"
               "再附一张 `preview_grid.py` 的近档占位预览，说明一格的尺度与构图。之后再贴下面的 prompt。\n"
               "> 出图后按 artKey 命名保存为 `art/region/raw/<artKey>.png`，再走工单 §6 的后处理流水线。\n"
               "> **先出标【试点】的 8 张**（工单 §7）：跑完 key_alpha / check_tile / preview_grid、定下密度与风格基准后再批量出其余的。"
               "批量出图时在同一个对话里连续生成，以第一张通过验收的图作为风格基准（风格参照只用 papertrails 截图与本项目自己出的图）。\n")

    out.append("\n## A. 地形底纸\n")
    for key, label, desc, color, no_rot, _s, _st in TERRAINS:
        size = "1024×1024，可平铺" + ("，行列固定朝向" if no_rot else "")
        item("A", f"terrain.ground.{key}", f"底纸：{label}", size, ground_prompt(label, desc, color, no_rot))
    k, label, desc, color, no_rot = SETTLEMENT_GROUND
    item("A", f"terrain.ground.{k}", f"底纸：{label}", "1024×1024，可平铺", ground_prompt(label, desc, color, no_rot))

    out.append("\n## B. 地形立牌\n")
    for key, label, _desc, color, _n, _s, standees in TERRAINS:
        for i, (desc, _h, a) in enumerate(standees):
            item("B", f"terrain.standee.{key}.{i}", f"立牌：{label} {'AB'[i]}", "1024×1024，透明底",
                 standee_prompt(desc, a, color))

    out.append("\n## C. 地点立牌（通用款）\n")
    for key, kind, label, desc in LOCATIONS:
        (w, h), cue = LOC_KIND[kind]
        item("C", key, label, "1024×1024，透明底", standee_prompt(desc, w / h, layered=True, cue=cue))

    out.append("\n## D. 野外地点与标记\n")
    for key, label, desc in POIS:
        w, h = POI_SIZE
        item("D", key, label, "1024×1024，透明底", standee_prompt(desc, w / h))

    out.append("\n## E. 前景小件\n")
    for key, label, desc, _h, a in PROPS:
        item("E", key, label, "1024×1024，透明底", standee_prompt(desc, a))

    out.append("\n## F. 装饰与遮罩\n")
    for key, label, size, style, common, desc, _mode, _out in DECOR:
        head = f"{style}\n\n" if style else ""
        item("F", key, label, size, f"{head}内容：{desc}。\n\n{common}")

    out.append("\n## H. 填充小件（各地形共用）\n")
    for key, label, desc, _h, a, _s in FILLERS:
        item("H", f"filler.{key}", f"填充小件：{label}", "1024×1024，透明底", standee_prompt(desc, a))

    out.append("\n## I. 地面散件（平贴在地上）\n")
    for key, label, desc, _size in GROUND_PIECES:
        item("I", f"ground.piece.{key}", f"地面散件：{label}", "1024×1024，透明底",
             f"{STYLE}{LIGHT_FLAT}\n\n内容：{desc}。\n\n{GROUND_PIECE}")

    if slots:
        out.append("\n## G. 专属地点（内容包槽位）\n")
        for s in slots:
            item("G", s["artKey"], f"专属地点：{s['artKey']}", "1024×1024，透明底", slot_prompt(s))

    return "\n".join(out), counts


def load_slots(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("slots", [])
    if not isinstance(data, list):
        raise ValueError(f"{path}：槽位文件应为数组，或带 slots 数组的对象")
    return data


def check(slots: list[dict]) -> list[str]:
    errs: list[str] = []
    keys = [a["artKey"] for a in assets([s for s in slots if s.get("artKey")])]
    dup = sorted({k for k in keys if keys.count(k) > 1})
    if dup:
        errs.append(f"artKey 重复：{dup}")
    if len(TERRAINS) != 17:
        errs.append(f"自然地形应为 17 种（PLAN §3.6），现有 {len(TERRAINS)}")
    _text, counts = build([])
    if "{" in _text or "}" in _text:
        errs.append("生成的 prompt 里残留花括号：有占位符没展开，或把数据表误当成文本拼了进去")
    for sec, want in EXPECTED_COUNTS.items():
        if counts.get(sec, 0) != want:
            errs.append(f"{sec} 类数量 {counts.get(sec, 0)} ≠ 工单清单 {want}（改表后请同步 EXPECTED_COUNTS 与工单 §1）")

    for key, _label, desc, _c, _n, _s, standees in TERRAINS:
        if bad := lint(desc, BANNED_ALL + BANNED_GROUND):
            errs.append(f"terrain.ground.{key} 的描述含易误导的词：{bad}")
        if len(standees) != 2:
            errs.append(f"{key} 应有 2 张立牌，现有 {len(standees)}")
        for i, (d, h, a) in enumerate(standees):
            if bad := lint(d, BANNED_ALL + BANNED_STANDEE):
                errs.append(f"terrain.standee.{key}.{i} 的描述含易误导的词：{bad}")
            if not (0.45 <= h <= 0.65):
                errs.append(f"terrain.standee.{key}.{i} 高 {h} 不在 0.45–0.65（工单 §1）")
            if not (0.3 <= a <= 3.0):
                errs.append(f"terrain.standee.{key}.{i} 宽高比 {a} 不合理")
    if set(CELL_DENSITY) != {t[0] for t in TERRAINS} or any(not (0 <= a <= b <= MAX_PER_CELL) for a, b in CELL_DENSITY.values()):
        errs.append(f"CELL_DENSITY 须覆盖全部 17 种自然地形，且每格张数在 0–{MAX_PER_CELL}（工单 §3.6）")
    keys_all = set(keys)
    if not set(PILOT) <= keys_all:
        errs.append(f"PILOT 里有不存在的 artKey：{sorted(set(PILOT) - keys_all)}")
    if bad := lint(SETTLEMENT_GROUND[2], BANNED_ALL + BANNED_GROUND):
        errs.append(f"terrain.ground.settlement 的描述含易误导的词：{bad}")
    for key, _k, _l, desc in LOCATIONS:
        if bad := lint(desc, BANNED_ALL + BANNED_STANDEE):
            errs.append(f"{key} 的描述含易误导的词：{bad}")
    for key, _l, desc in POIS:
        if bad := lint(desc, BANNED_ALL + BANNED_STANDEE):
            errs.append(f"{key} 的描述含易误导的词：{bad}")
    for key, _l, desc, h, _a in PROPS:
        if bad := lint(desc, BANNED_ALL + BANNED_STANDEE):
            errs.append(f"{key} 的描述含易误导的词：{bad}")
        if not (0.2 <= h <= 0.35):
            errs.append(f"{key} 高 {h} 不在 0.2–0.35（工单 §1）")
    fkeys, pkeys = {f[0] for f in FILLERS}, {g[0] for g in GROUND_PIECES}
    for key, _l, desc, h, _a, _s in FILLERS:
        if bad := lint(desc, BANNED_ALL + BANNED_STANDEE):
            errs.append(f"filler.{key} 的描述含易误导的词：{bad}")
        if not (0.1 <= h <= 0.3):
            errs.append(f"filler.{key} 高 {h} 不在 0.1–0.3（工单 §1.5）")
    for key, _l, desc, _size in GROUND_PIECES:
        if bad := lint(desc, BANNED_ALL):
            errs.append(f"ground.piece.{key} 的描述含易误导的词：{bad}")
    if set(DETAIL_POOLS) != {t[0] for t in TERRAINS} | {"settlement"}:
        errs.append("DETAIL_POOLS 须覆盖 17 种自然地形与 settlement")
    for t, (fill, (flo, fhi), pieces, (plo, phi)) in DETAIL_POOLS.items():
        if set(fill) - fkeys or set(pieces) - pkeys:
            errs.append(f"DETAIL_POOLS[{t}] 引用了不存在的件：{sorted((set(fill) - fkeys) | (set(pieces) - pkeys))}")
        if t in WATER_TERRAINS and pieces:
            errs.append(f"DETAIL_POOLS[{t}]：水面不放地面散件")
        if not (0 <= flo <= fhi <= MAX_FILLERS and 0 <= plo <= phi <= MAX_PIECES) or (fhi and not fill) or (phi and not pieces):
            errs.append(f"DETAIL_POOLS[{t}] 的张数范围不合理（填充 ≤ {MAX_FILLERS}、散件 ≤ {MAX_PIECES}，且池不能为空）")
    if set(SHORE[0]) - fkeys or not set(WATER_TERRAINS) <= {t[0] for t in TERRAINS}:
        errs.append("SHORE 引用了不存在的填充小件，或 WATER_TERRAINS 里有未知地形")
    used = {k for v in DETAIL_POOLS.values() for k in v[0]} | {k for v in DETAIL_POOLS.values() for k in v[2]}
    if unused := (fkeys | pkeys) - used:
        errs.append(f"这些件没有任何地形用到：{sorted(unused)}")
    for key, *_rest in DECOR:
        desc = _rest[4]
        if bad := lint(desc, BANNED_ALL):
            errs.append(f"{key} 的描述含易误导的词：{bad}")

    for i, s in enumerate(slots):
        tag = s.get("artKey") or f"#{i}"
        miss = [f for f in SLOT_FIELDS if not str(s.get(f, "")).strip()]
        if miss:
            errs.append(f"槽位 {tag} 缺字段：{miss}")
            continue
        if not SLOT_KEY_RE.match(s["artKey"]):
            errs.append(f"槽位 {tag}：artKey 须为 loc.city.<id> 或 loc.sectSeat.<id>（id 为字母数字下划线连字符，不能用 default.*）")
        if "group" in s and not SLOT_GROUP_RE.match(str(s["group"])):
            errs.append(f"槽位 {tag}：group 只能含字母数字下划线连字符")
        for f in SLOT_FIELDS[1:]:
            v = str(s[f])
            if bad := lint(v, BANNED_ALL + BANNED_STANDEE):
                errs.append(f"槽位 {tag} 的 {f} 含易误导的词：{bad}")
            if len(v) > 60:
                errs.append(f"槽位 {tag} 的 {f} 超过 60 字，请精简")
        unknown = set(s) - set(SLOT_FIELDS) - {"group", "note"}
        if unknown:
            errs.append(f"槽位 {tag} 有未知字段：{sorted(unknown)}")
    return errs


def archetype_table() -> str:
    fit = {"city": "城市", "sectSeat": "门派驻地", "both": "两者"}
    rows = ["| id | 名称 | 适用 | 通用描述 |", "| --- | --- | --- | --- |"]
    rows += [f"| `{i}` | {n} | {fit[f]} | {d} |" for i, n, f, d in ARCHETYPES]
    return "\n".join(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--slots", type=Path, help="内容包的专属地点槽位 JSON（数组，或 {\"slots\": [...]}）")
    ap.add_argument("--check", action="store_true", help="只校验，不写文件")
    ap.add_argument("--archetypes", action="store_true", help="打印建筑原型备选清单（Markdown 表格）")
    ap.add_argument("--out", type=Path, default=OUT, help=f"prompt 输出路径（默认 {OUT.relative_to(ROOT)}）")
    ap.add_argument("--list-out", type=Path, default=LIST_OUT, help=f"素材清单输出路径（默认 {LIST_OUT.relative_to(ROOT)}）")
    args = ap.parse_args()

    if args.archetypes:
        print(archetype_table())
        return 0
    try:
        slots = load_slots(args.slots) if args.slots else []
    except (OSError, ValueError) as e:
        print(f"读取槽位失败：{e}", file=sys.stderr)
        return 1
    errs = check(slots)
    if errs:
        print("\n".join(errs), file=sys.stderr)
        return 1
    text, counts = build(slots)
    total = sum(counts.values())
    summary = "、".join(f"{k} {v}" for k, v in sorted(counts.items()))
    if args.check:
        print(f"OK：{total} 条 prompt（{summary}）")
        return 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8")
    listing = {"version": 1, "generatedBy": "tools/art/region_prompts.py", "items": assets(slots)}
    args.list_out.parent.mkdir(parents=True, exist_ok=True)
    args.list_out.write_text(json.dumps(listing, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    def rel(p: Path) -> str:
        try:
            return str(p.resolve().relative_to(ROOT))
        except ValueError:
            return str(p)
    print(f"已写入 {rel(args.out)}：{total} 条 prompt（{summary}）；清单 {rel(args.list_out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
