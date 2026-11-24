# 武侠·修仙·神话视觉元素总纲：GPT 生图引导（以太吾绘卷为例）

Nov 24, 2026 · @yiding

## 结论

**一句话定位：青绿金碧山水做底色，剪纸、皮影、宣纸做材质，太吾式江湖做内容。** 保留 papertrails 的“立体书纸模型”媒介。换掉它的内容、色彩、地形和光。

| 层 | 画面面积 | 每 10 个资产 | 放在哪里 | 典型元素 |
| --- | --- | --- | --- | --- |
| 武侠 · 江湖 | 70% | 7 个 | 近景和中景，画面主体 | 门派山门、客栈、镖局、擂台、练功场、兵器架、石阶栈道、松、竹 |
| 修仙 · 仙神 | 20% | 2 个 | 高处、远处、画面边缘 | 云海、悬空楼阁、仙鹤、丹炉、金线勾边、灵芝 |
| 神话 | 10% | 1 个 | 一个焦点，半隐在云里或山里 | 蛟、麒麟、白鹿、玄鸮、剑冢、玄石紫竹 |

### 为什么会漂移成“田园温馨”

1. **内容：** papertrails 的资产是欧洲田园。小屋、风车、谷仓、草垛、南瓜车、栅栏都是“安家”的符号。GPT 会照搬这些符号。
2. **色彩：** 它的截图主色全部是暖橙褐（见“色彩”一节的色板）。
3. **地形和光：** 缓坡草甸、圆润造型、金色暖光、窗内暖灯。这四样合起来就是“温馨”。
4. **只换颜色不够：** 国风种田游戏《淡墨水云乡》也用青绿和水墨，但内容是田地和店铺，所以仍然是种田感。必须换内容。

### 防漂移硬规则

1. **地形要竖。** 用峭壁、孤峰、栈道、瀑布。不用连绵缓坡草甸。
2. **色调要冷。** 石青、石绿、墨、纸白占画面 90%。暖色只用在山脚赭石、木构和朱砂点睛。
3. **光要清。** 用阴天散射光、晨雾、月光。不用金色夕阳，不用窗内暖灯。
4. **内容要“在路上”。** 江湖是客栈、驿站、镖局、擂台、关隘。不是安家落户的农舍。
5. **道具要有张力。** 用兵器架、木人桩、石碑、镖旗、灯笼柱。不用宠物、南瓜、蜂箱、草垛、蘑菇。
6. **人物要有架势。** 用黑色剪影小人，摆武术姿势，约 6–7 头身。不用 Q 版村民。
7. **要留白。** 每张图至少 30% 是云、雾、水或空纸。温馨感来自“塞满”。
8. **农桑只做配角。** 桑园、桃源、农田一张图最多一块。配石阶、云雾或门派建筑，不单独成景。

**用法：** 先读本节、“papertrails 拆解”、“色彩”和“GPT 生图提示词”。做具体资产时，再查对应章节。

## papertrails 拆解

**问题不在纸，在纸上的东西。** papertrails 是 Three.js + Vite 项目：一个纸片旅人走过一本无尽的立体书。它的纸张贴图、法线和移轴微缩感都可以留下。“田园温馨”来自内容、色彩、地形和光。

| 维度 | papertrails 现状 | 保留 | 替换为 |
| --- | --- | --- | --- |
| 媒介 | 卡纸立体书；纸纤维细节贴图和法线贴图 | “纸”和折页弹起的结构 | 宣纸或皮纸纤维、剪纸镂空、皮影半透明、拓片墨底 |
| 地形 | 缓坡草甸、圆润小丘 | 地块拼接的玩法 | 竖直峭壁、层叠山峦、栈道、瀑布；地块侧面做成断崖 |
| 建筑 | 红色鱼鳞瓦小屋、风车、谷仓、教堂、庄园 | “一块地一座建筑”的读法 | 歇山顶殿宇、山门牌坊、亭台楼阁、客栈、镖局、吊脚楼 |
| 道具 | 蜂箱、草垛、南瓜车、栅栏、路牌、蘑菇 | 道具点缀的节奏，但减量 | 兵器架、木人桩、石碑、灯笼柱、竹篱、灵芝 |
| 生物 | 农场宠物和家畜 | 少量动态点缀 | 鹤、鹿、猿、鸦；虎只放远景或做事件 |
| 色彩 | 秋橙、赭黄、橄榄绿；截图主色全是暖色 | 纸的米白底 | 石青石绿为主，墨与纸为骨，金只勾边 |
| 光 | 金色暖光；夜景窗户透暖灯 | 昼夜切换 | 白天用阴天散射光和晨雾；夜里用冷蓝月光，只留几盏灯笼 |
| 镜头 | 移轴近景、低机位 | 移轴微缩 | 加高远和平远的远景层；背景做成长卷 |
| 人物 | 纸片旅人 | “旅人走过书页”的设定 | 黑色剪影侠客（太吾小黑人式）或皮影人 |
| 文字 | 英文招牌和 UI | — | 不让 GPT 写字；中文牌匾以后自己加 |

**核心换法：把“无尽立体书”换成“无尽长卷”。** 《千里江山图》是近 12 米的手卷，用散点透视一段段展开。旅人走过书页，就是走过一幅展开的山水长卷。立体书的弹起结构不变，只把每一页的内容换成一段长卷。

## 太吾绘卷词条里的视觉要素

**太吾的画面词汇分六层：州域、门派、地块、建筑、资源点、奇遇。** 世界有 15 个州域。每个州域有 9 个地区：主城、门派、次要地区和 6 块“玄石之地”。词条来自灰机 wiki；“旧/”开头的页面属于 2018 年的纪念版。

**太吾自己的门派地格图就是立体书地块。** 每张都是等距立方体小模型：一块断崖土块，黑色描边，平涂矿物青绿与土褐，顶上一组门派建筑。例如少林是褐色断崖上的红墙寺院，武当是赭色土台上的蓝顶道观，百花谷是瀑布、石柱和花，血犼教是暗青底上的红色祭台。这是最好的“纸模型地块”参照。

### 十五门派

| 州域 · 门派 | 所在 | 正邪 · 立场 | 内功 | 标语 | 生图关键词（建议） |
| --- | --- | --- | --- | --- | --- |
| 京畿 · 少林派 | 嵩山 | 正派 · 仁善 | 金刚 | 禅武之道 | 塔林、红墙禅院、演武场、晨钟 |
| 巴蜀 · 峨嵋派 | 峨眉山 | 正派 · 仁善 | 紫霞 | 隐世白猿 | 金顶云海、冷杉雾林、白猿 |
| 广南 · 百花谷 | 白鹿泽 | 正派 · 仁善 | 玄阴 | 玄鸮白鹿 | 花谷瀑布、石柱、水泽、白鹿、玄鸮 |
| 荆北 · 武当派 | 武当山 | 正派 · 中庸 | 纯阳 | 龟蛇蟠扶 | 山巅金殿、依山道观、龟蛇（玄武） |
| 山西 · 元山派 | 大小元山 | 正派 · 刚正 | 归元 | 石牢三魔 | 双峰、黄土崖、石窟、石牢 |
| 广东 · 狮相门 | 莲花山 | 中立 · 叛逆 | 金刚 | 文武双全 | 醒狮、书院、岭南镑耳墙 |
| 山东 · 然山派 | 然山 | 中立 · 中庸 | 紫霞 | 青琅仙阁 | 石绿仙阁、琴棋书画 |
| 荆南 · 璇女派 | 璇女峰 | 中立 · 刚正 | 玄阴 | 镜水倒颠 | 孤峰、镜湖倒影、瀑布、环形水纹 |
| 福建 · 铸剑山庄 | 湛卢山 | 中立 · 中庸 | 纯阳 | 铜生试剑 | 炉火、剑池、铜绿、试剑石 |
| 辽东 · 空桑派 | 空桑山 | 中立 · 唯我 | 归元 | 奇毒绝方 | 雪林、晒药架、毒草园 |
| 西域 · 金刚宗 | 昆仑山 | 邪派 · 唯我 | 金刚 | 真经无字 | 雪山、白塔、经幡、金顶 |
| 云南 · 五仙教 | 黑水 | 邪派 · 叛逆 | 紫霞 | 五圣心毒 | 黑水、吊脚楼、银饰、五毒 |
| 淮南 · 界青门 | 界青崖 | 邪派 · 叛逆 | 玄阴 | 善恶无生 | 青黑崖壁、夜行、屋脊、暗器 |
| 江南 · 伏龙坛 | 赤明岛 | 邪派 · 刚正 | 纯阳 | 伏龙化羽 | 湖中赤岛、坛台、龙柱、羽饰 |
| 江北 · 血犼教 | 血犼谷 | 邪派 · 唯我 | 归元 | 血冢遗姝 | 深谷、血池、坟冢、暗红祭台 |

建议的色调分工：正派用石青和纸白，对称、明亮。中立以自然地貌为主。邪派用玄青、黛和一点朱砂，但仍留在青绿体系里。

### 地块（纪念版：每块是一个长方体）

| 产出 | 地块 | 生图要点 |
| --- | --- | --- |
| 食材 | 原野、湖泊、农田 | 原野和农田最容易变田园。画成山前平川，远处放关隘或山门 |
| 木材 | 林地、密林、园林 | 松林、竹林；园林 = 文人园林（亭、假山、曲桥） |
| 金石 | 山岳、洞穴、石林 | 主力地形：峭壁、洞口、石笋 |
| 织物 | 丘陵、桃源、桑园 | 桃源 = 洞口后的隐谷；桑园 = 梯台桑林加蚕室 |
| 药材 | 峡谷、沼泽、药园 | 峡谷栈道、雾沼、药圃 |
| 其他 | 荒野、暗渊 | 荒野 = 枯树乱石；暗渊 = 黑色裂谷（神话层） |
| 聚落 | 都会、门派、市镇、关寨、村庄 | 见“房屋与建筑” |

地图上的聚落还分：主城、门派、太吾村、村庄（村、乡）、关寨（寨、关）、市镇（镇、驿）。聚落之间有驿道和驿站。

### 资源点

- **江湖层：** 水域、石山、树林、孤峰、草药、花谷、宝石、沃野、兽群、密林。
- **仙与神层：** 毒沼、火池、陨铁坑、太始林、长春涧、玄蛇窟、奇香原、风水龙穴、灵脉、玄冰。
- **废弃物：** 杂草堆、乱石堆、废墟。

### 建筑（按技艺，节选）

每个名字就是一个现成的资产提示词。

| 技艺 | 建筑名 |
| --- | --- |
| 武学 | 练功房、桩林、木人阵、铜人阵、试剑台、演武场、搏虎牢、凌云阶、隔世塔、剑冢、八阵图、追影洞、七弦楼 |
| 音律 | 琴舍、乐坊、知音阁、百戏园、移情居、仙境、凤凰台 |
| 弈棋 | 弈轩、棋馆、斗弈台、石谱园、琉璃馆、镜中台 |
| 诗书 | 书房、书院、翰苑、龙龟山、照夜楼、藏书阁 |
| 绘画 | 画阁、丹青馆、流光园、五色窟、天香彩阁、画影轩 |
| 术数 | 观星台、占卜馆、祥天高台、摘星楼、昆仑塔、生灭两星幡 |
| 品鉴 | 茶馆、酒肆、闻香苑、四海府、胡舫、神仙苑、茶园、蒸酒坊 |
| 锻造 | 火炼室、铁匠铺、锻冶坊、水排、陨铁矿场、龙泉七星井、神火铸 |
| 制木 | 木工房、营造坊、黑脂池、伐木场、幽冥窑、神木林 |
| 织锦 | 绣楼、织造坊、锦绣阁、缀星阁、蛇骨绫机、百花瀑、彩桑园、神彩梭 |
| 巧匠 | 珠宝铺、琳琅阁、攻玉楼、赤血镜、金刚解石台、玲珑台、神光璧 |
| 医术 | 药房、药师馆、银盖冰棺、药圃、水火青炉、神农涧 |
| 毒术 | 幽室、毒市、暗牢、炼瘴池、废人窟、血池、神龙柱 |
| 道法 | 云房、法事道场、道观、三清殿、辟谷崖、朝元洞、丹房 |
| 佛学 | 禅房、寺院、佛塔、法堂、见性洞、枯荣台、阅经阁 |
| 厨艺 | 食窖、酒楼、百家宴、灶王玄鼎、四季园、天成乡、龙宫 |
| 杂学 | 长街、市集、赌坊、勾栏瓦舍、花舫、游园、玄圃、当铺、贤士馆 |
| 资源 | 堤堰、矿井、石碑、筒车、琉璃索、护林墙、悬空栈、引涧渠、云篷、秘陵、冰夷像 |
| 村庄 | 太吾氏祠堂、居所、宴堂、仓库、元鸡舍、轮回台、茶马帮 |

### 人与物

- **身份：** 村长、大夫、豪富、农户、乞丐、权贵、商人、手艺人、文人、大当家、管事、下九流、镇长、城主、护冢、匠人、使者。
- **衣着：** 百衲衣、布衣素裳、峨眉锦衣、坏色僧衣、将军披挂、界青夜行装、老君袍、练功服、猎户装、苗绣蜡染衣、明王法衣、天师大氅、武当道袍、五彩巫衣、璇女灵裘、真武道袍、元山苦行衣。
- **代步（江湖）：** 灰驴、骡子、瘦马、骏马、青牛、牲牛、独轮车、太平车、竹板橇、陋棚栈车。
- **代步（名贵）：** 汗血宝马、西域白马、关外名驹、驷马轩车、双辕安车、七香车、司里鼓车。
- **代步（机关与仙）：** 木牛流马、武侯四轮车、风后车、八角宝楼车、龙雀云船、麒麟华盖车、玄龙驭。
- **材料：** 翡翠、寒玉、昆仑活玉、龙血墨玉、青金石、羊脂白玉、五色琉璃；九曲紫竹、栖凤梧桐、乌金紫檀、龙盘根、青菩提枝、活桃木；天外寒铁、玄铁、镔铁、十二彩霞银；冰蚕银丝、天蚕丝、鸾凤羽、金缕蝉衣、白蟒鳞、虎衣。
- **西域珍宝：** 波斯鏎金银壶、敦煌星图、佛牙、火浣布、琉璃夜光杯、冒顿鸣镝箭、驼铃。
- **生活物：** 18 种茶（碧螺春…竹叶青）、18 种酒（东坡蜜酒、猴儿酒、花雕、杏花汾清…）、促织（斗蟋蟀）。
- **神兵：** 伏虞剑及其碎片；化形·冰笛、符箓、蛊爪、拂尘…；用神·藏鬼、持妖、御邪。

### 奇遇（可直接做场景题目）

比武招亲、茶会、促织大会、大片血迹、古墓仙人、剑冢、静谧竹庐、酒宴、奇书宝典、七元符图、商贾云集、深谷出口、天材地宝、外道巢穴、武林大会、玄石与紫竹、沿街卖艺、英雄猴杰。

### 剑冢、相枢与玄石紫竹（神话层核心）

- **相枢** 是“众生万相之核枢”，是最终敌人。370 年前，初代太吾聚集十五门派与九把神剑对抗它。
- **九个剑冢** 的尽头各有一个相枢化身：九寒（大玄凝）、以向（溶尘隐）、卫起（解龙魄）、大岳瑶常（伏邪铁）、术方（鬼神霞）、莫女（莫女衣）、血枫（囚魔木）、衣以候（焚神炼）、金凰儿（凤凰茧）。括号里的名字各自带一个材质主题：冰、尘、龙、铁、霞、衣、木、火、茧。
- **玄石之地** 是被相枢侵蚀的土地。“玄石与紫竹”奇遇里，紫竹长在黑色玄石上。**黑石加紫竹是太吾独有的信号，适合做神话层的焦点。**

### 野兽、蛟与龙

- **现实猛兽（武侠层）：** 老虎、花豹、黑豹、狮子、棕熊、白熊、野猪、野牛、巨蛇、巴蟒、恶鹰、猴子。
- **异兽（神话层）：** 黑山君、白虎、白牛、金狮、金鹏、夔牛、墨麒麟、九头蛇、三眼魈、四不像、搬山火龟、披星飞蜈、渊虬、芝人、玄鸠、玄猪、灵猴。
- **蛟：** 百宝、焚山、鬼狱、荒途、火池、乱鳞、披云、麒麟、四化、天雷、吞天、五色、仙山、渊下、镇海。
- **龙生九子（DLC）：** 霸下、狴犴、嘲风、螭吻、负屃、蒲牢、囚牛、狻猊、睨眦；另有小白龙、小赤龙、小黑龙、小黄龙、小青龙。
- **蛇类：** 蠹经蛇、断邪、九赤斑蛇、流金火蛇、炐蛇、日魂朱景、瑞蛇、天烛、玄州金蛇、朱炎。

注意：有玩家认为太吾“没那么武侠”，原因之一是神魔和化形元素多。所以本文把神话层压在 10%。

## 武侠元素库（70%）

**武侠层画的是“人在江湖”：在路上、有规矩、有戒备、有代价。** 它也有烟火气。但烟火在客栈、驿站和市集，不在自家菜园。

**规则：每张武侠图至少有一个“事件钩子”。** 例如一面镖旗、一把插在地上的剑、一处打斗痕迹、两个对峙的人影。

### 江湖场所

| 场所 | 画面要点 | 和田园版的区别 |
| --- | --- | --- |
| 客栈 | 两层木楼、酒旗、拴马桩、二楼回廊 | 过路人的店，不是自家小屋 |
| 酒肆 · 茶馆 | 竹棚、长凳、茶旗、说书台 | 客人是带兵器的旅人 |
| 镖局 | 镖旗、石狮、镖车、门前空地 | 货物要护送，有危险 |
| 驿站 · 驿道 | 驿亭、界碑、马棚、长亭 | 路通向远方，不在此安家 |
| 擂台 | 高台、锦旗、兵器架、围观人影 | 一眼就是竞争 |
| 演武场 · 练功场 | 夷土地、木人桩、梅花桩、石锁、箭靶 | 训练不是娱乐 |
| 关隘 · 城门 | 城楼、箭楼、瓮城、吊桥、关卡 | 有守律和盘查 |
| 山寨 | 木栅、望楼、聚义厅、寨旗 | 有戒备，不对外开放 |
| 渡口 · 码头 | 乌篷船、渡船、栈桥、芦苇 | 水路江湖，不是钓鱼小屋 |
| 市集 · 长街 | 招幌、摆摊棚、牌坊、灯笼串 | 人流杂，有卖艺、有赌坊 |
| 古墓 · 秘洞 | 石门、长明灯、石棺、机关 | 有秘密和危险 |
| 破庙 · 乱葬岗 | 断碑、枯树、鸦、残缺神像 | 夜戏、伏击 |
| 竹林 · 松林 · 栈道 · 瀑布深潭 | 对决舞台，小人配大景 | 自然是决斗场，不是野餐地 |

### 人物身份

侠客、剑客、刀客、镖师、捕快、书生、僧人、道士、女侠、刺客、乞丐、商人、匠人、猎户、樵夫、渔夫、店小二、说书人、郎中、卖艺人。太吾还有大当家、管事、下九流、护冢、使者、城主。

### 服饰（剪影要一眼认出）

- **基本形：** 交领右衽、束腰、箭袖或宽袖、绑腿、布鞋、发髻或束发、发带。
- **行头：** 斗笠、蓑衣、披风、面纱、蒙面巾、背剑、包袱、酒葫芦、油纸伞。
- **身份服：** 道袍、僧衣袋裟、夜行衣、劲装、官服、苗绣银饰。
- **动势物：** 发带、衣摆、剑穗、披风。它们让静止的剪影有风。
- **避免：** 和服宽腰带、武士铠甲、武士刀。GPT 画“东方”时很容易混入日式元素。

### 兵器

剑、单刀、朴刀、大刀、枪、棍、戟、钺、斧、锤、鞭、锏、钩、叉、扇、判官笔、拂尘、绳镖、峨眉刺。乐器也是兵器：笛、琴。暗器：飞刀、袖箭、飞镖、银针。

### 器物与道具

兵器架、木人桩、梅花桩、石锁、沙袋、箭靶、镖旗、镖车、令牌、秘籍、卷轴、酒坛、酒葫芦、灯笼、拴马桩、界碑、石狮、香炉、铜钟、木鱼、药箱、竹篓、乌篷船。

### 江湖事件（给画面张力）

比武招亲、武林大会、劫镖、夜袭、雨中对决、竹林对峙、客栈打斗、闭关、拜师、护送、追杀、争夺秘籍。其中比武招亲、武林大会、沿街卖艺、外道巢穴、大片血迹都是太吾奇遇。

## 房屋与建筑

**建筑分三种身份：江湖建筑靠院落和招牌，门派建筑靠屋顶等级和中轴，仙家建筑靠高、靠悬、靠云。** 风格优先用唐宋式：出檐深、斗拱大、屋面曲线柔、颜色素。《千里江山图》是北宋作品，两者一致。不要用清式的浓重彩画和红墙黄瓦大片铺开。

### 屋顶等级

| 屋顶 | 等级 | 本文的用法 | 英文提示词 |
| --- | --- | --- | --- |
| 重檐庑殿顶 | 最高 | 只给皇城正殿，少用 | double-eaved hip roof |
| 重檐歇山顶 | 次高 | 门派主殿、城楼 | double-eaved hip-and-gable roof |
| 单檐庑殿顶 | 高 | 大寺大观的正殿 | single-eaved hip roof |
| 单檐歇山顶 | 中 | 门派殿宇、山门、楼阁 | hip-and-gable roof |
| 悬山顶 | 低 | 客栈、民居、廊 | overhanging gable roof |
| 硬山顶 | 最低 | 北方民居、店铺 | flush gable roof |
| 攒尖顶 | 不排等级 | 亭、塔、仙阁顶 | pyramidal pavilion roof |
| 卷棚顶 | 不排等级 | 园林、游廊 | rolled-ridge roof |

配比建议：江湖建筑用悬山、硬山。门派用歇山，主殿用重檐。仙阁用攒尖或重檐，顶尖可以是金。

### 构件与装饰

- **斗拱：** 柱头上层层出挑的木构件。唐宋式大而疏，是“古”的关键信号。
- **飞檐翘角：** 南方翘得高，北方平缓。仙阁用高翘，关隘用平缓。
- **鸱尾：** 唐宋正脊两端的鸟尾形装饰。比清式龙吻更古。
- **瓦：** 民居和寺观用青灰筒瓦。仙阁用青绿琉璃。武当、峨眉可用金顶。
- **彩画：** 宋《营造法式》有“碾玉装”“青绿叠晕棱间装”，就是青绿叠晕，和青绿山水同色系。
- **台基：** 高等级建筑坐在须弥座上，配石栏杆。仙家建筑的台基可以直接是崖顶。
- **门窗：** 格扇门、直棂窗、月洞门、漏窗。它们是剪纸镂空最好的题材。

### 院落与布局

- **中轴对称、多进院落。** 一组建筑沿中轴一进一进往里走。
- **佛寺：** 山门 → 天王殿 → 大殿 → 法堂或藏经阁；旁边或后方立塔。
- **道观：** 山门 → 灵官殿 → 主殿（三清殿或真武殿）。
- **依山门派：** 长石阶串起多层台地，每层一组殿，最高处一座阁或塔。
- **牌坊和山门** 是入口标志。在立体书里，它就是翻页时第一个弹起的东西。

### 江湖建筑与地域民居

| 类型 | 形 | 太吾对应 |
| --- | --- | --- |
| 客栈 | 两层木楼、悬山顶、酒旗、回廊 | 驿道、市镇 |
| 镖局 | 硬山院落、门前石狮、镖旗 | 镖局（武学建筑） |
| 关隘 | 城墙、重檐城楼、箭楼、瓮城 | 关寨 |
| 山寨 | 木栅、望楼、木板顶聚义厅 | 关寨、外道巢穴 |
| 江南水乡 | 白墙黛瓦、马头墙、石拱桥 | 江南 |
| 岭南 | 镑耳墙、灰塑 | 广东 · 狮相门 |
| 西南 | 吊脚楼、风雨桥 | 云南 · 五仙教 |
| 西域 | 白墙平顶、金顶、白塔、经幡 | 西域 · 金刚宗 |
| 北方 | 四合院、窑洞、石窟 | 山西 · 元山派 |
| 关外林区 | 林中药庐、晒药架 | 辽东 · 空桑派 |

注意：papertrails 有雪屋、高脚屋、小木屋。中式建筑要靠屋顶形和材料拉开差别，不要画成圆顶木屋。

### 园林与仙家建筑

- **园林：** 亭、台、楼、阁、榭、舫、廊、拱桥、廊桥、曲桥、假山。太吾例：知音阁、照夜楼、藏书阁、流光园、石谱园。
- **仙家：** 崖壁或浮岛上的悬空阁、直上云层的长石阶、天门、观星台、丹房、洞府石门、云中廊桥。

### 太吾建筑名 → 资产译法

| 太吾名 | 画成什么 |
| --- | --- |
| 桩林 | 一片高低不同的木桩，桩顶站人 |
| 木人阵 · 铜人阵 | 一圈木人或铜人，围着一块夷土地 |
| 试剑台 | 崖边石台，地上剑痕，一块被劈开的石 |
| 凌云阶 | 直上云层的长石阶 |
| 隔世塔 | 云中孤塔 |
| 悬空栈 | 峭壁栈道和贴壁小楼 |
| 琉璃索 | 两峰之间的索桥，挂琉璃灯 |
| 筒车 · 水排 | 水边木水车 · 水力鼓风炉（替代风车） |
| 龙泉七星井 | 七口井排成北斗形，旁边是铸剑炉 |
| 观星台 · 摘星楼 | 高台上的浑仪 · 伸入夜空的高楼 |
| 剑冢 | 插满断剑的土丘或石窟 |
| 血池 · 神龙柱 | 暗红池水 · 盘龙石柱 |
| 勾栏瓦舍 · 花舫 | 戏台和看棚 · 水上画舫 |
| 茶马帮 | 马帮驮队和茶包 |

### 用色与纸艺

- **颜色：** 墙用白、土黄或灰。柱用朱红，但面积小。瓦用黛青或青绿琉璃。屋脊和檐口可以勾一条金线。
- **纸艺：** 屋顶用折纸折出瓦垄。墙用宣纸。窗格用剪纸镂空。灯笼用半透明纸。建筑边缘切得干净，和山的撕纸毛边形成对比。

## 山的质感

**山是这个风格的主角。一座山 = 山形 + 皴法纹理 + 青绿设色五层 + 云雾切割。** 《千里江山图》的“蓝山金脚”来自赭石打底，再用石绿、石青罩染。画里暖黄的部分主要是赭石和发黄的绢底。要更“仙”，再加金碧山水的泥金勾线。

### 青绿设色五层（从底到面）

1. **墨骨：** 墨线勾出山形和皴纹。
2. **赭石底：** 山脚、坡面、树干、土地用赭石。赭石是赤铁矿。
3. **石绿：** 山腰和坡顶罩染。石绿是孔雀石，按研磨粗细分头绿、二绿、三绿、四绿。
4. **石青：** 山头和峰尖点染。石青是蓝铜矿。
5. **金线（可选）：** 沿山脊和轮廓勾泥金。这就是“金碧山水”。

朱砂、雄黄、雌黄只点在花、人物衣服等小处。**规则：每座山从下到上都是赭 → 绿 → 青。** 这条渐变就是青绿山水的签名。

### 皴法（山石纹理）

| 皴法 | 形态 | 代表画家 | 适合 | 英文提示词 |
| --- | --- | --- | --- | --- |
| 斧劈皴 | 斜向块面，像斧劈木 | 李唐；马远、夏圭 | 北方硬石、峭壁、断崖 | axe-cut texture strokes, angular rock facets |
| 雨点皴 | 密集短点 | 范宽 | 雄伟石山、正面大崖 | dense raindrop dot texture |
| 披麻皴 | 长而柔的平行线，像散开的麻 | 董源、巨然 | 江南土山、缓坡 | long hemp-fiber strokes |
| 米点皴 | 横卧的墨点堆叠 | 米芾、米友仁 | 烟雨云山 | horizontal Mi-style ink dots, misty hills |
| 卷云皴 | 卷曲的弧线，像翻卷的云 | 郭熙 | 奇峰、雾中山石 | curling cloud-like strokes |
| 解索皴 · 牛毛皴 | 绞索线 · 极细密短线 | 王蒙 | 繁密、湿润的山 | twisted-rope strokes, fine ox-hair strokes |
| 荷叶皴 | 从峰顶向下分开的筋脉 | 赵孟頫 | 尖峰、山顶 | lotus-leaf vein strokes |
| 折带皴 | 横折的带状线 | 倪瓒 | 平坡、湖石 | folded-belt strokes |
| 拖泥带水 · 刮铁 | 湿墨大块面 · 硬折线 | — | 水边石 · 硬岩 | wet ink washes, iron-scraped lines |

张大千的说法：江南土山宜披麻，北方石山宜雨点、鬼面。

**本项目建议：** 主峰和断崖用斧劈皴，硬、有武侠感。远山用米点或披麻，柔、有仙气。神话层的奇峰用卷云皴。

### 山形

- **主峰：** 高，居中偏后，左右客峰拱卫。
- **孤峰 · 石笋：** 竖直柱状，适合仙和神话层。
- **断崖：** 地块侧面直切，露出岩层。太吾的长方体地块就是这样。
- **台地：** 门派建在台地上，用石阶连接。
- **洞府：** 崖壁开洞，洞口有石门或瀑布帘。
- **峡谷：** 两壁夹一线天，栈道沿壁走。
- **远山：** 只剪一条轮廓，石青淡色，一层层变浅。
- **避免：** 半球形的“包子山”、光滑草坡、一样高的连绵小山。

### 云雾与水口

- **腰云：** 横向云带切断山腰，上下各露一截。
- **云海：** 群峰只露山尖。用在仙层。
- **留白即云：** 不画云，留纸白。仙家场景可以加如意形的勾线祥云。
- **水口：** 两山之间出水的地方。放瀑布、溪口、桥或渡口。
- **水纹：** 细密的网状波纹。江面以纸白为底。
- **瀑布：** 白色长条，分两到三叠。

### 纸艺与 3D 做法

| 画法 | 纸艺做法 | 3D 做法 |
| --- | --- | --- |
| 墨骨与皴纹 | 黑色细线压印或刻线 | 法线贴图加刻线；描边 shader |
| 赭 → 绿 → 青 | 三层彩纸叠贴，或一张纸上渐变 | 按高度渐变的贴图或顶点色 |
| 金线 | 金箔纸细条贴在山脊 | 山脊一条低亮度的细金线 |
| 云带 | 半透明宣纸或硫酸纸插片 | 半透明平面，边缘柔化 |
| 远山 | 单层剪影，逐层变浅 | 多层面片加雾 |
| 山体边缘 | 撕纸毛边 | 不规则 alpha 边 |

英文片段：`blue-green landscape mountains, ochre bases rising into malachite-green slopes and azurite-blue peaks, ink contour lines, axe-cut texture strokes on cliffs, horizontal mist bands cutting the mountainsides, thin gold line along the ridges`

## 修仙仙神元素库（20%）

**仙层只占五分之一，作用是给“仙气”：放在高处、远处和边缘。** 古典仙气靠留白、云、金线和素色。网游仙侠靠粒子、霓虹和华丽盔甲。本项目只要前者。

### 仙山与洞府

- **山：** 云海孤峰、悬浮山岛（底部垂细瀑布）、海上三仙山（蓬莱、方丈、瀛洲）、昆仑与瑶池。
- **路：** 直上云层的天梯、云上的天门、两峰之间的索桥。
- **洞府：** 崖壁石门加匾额，洞内石床、石桌、蒲团。
- **太吾对应：** 然山派“青琅仙阁”、昆仑塔、摘星楼、辟谷崖、朝元洞、仙境、神仙苑、古墓仙人、天材地宝。“青琅珕”是石绿的另一个名字，所以然山可以画成石绿色的仙阁。

### 法器与丹药

丹炉（三足鼎、八卦炉）、葫芦、拂尘、飞剑、符箓（黄纸朱砂字）、法印、罗盘、铜镜、玉简、宝塔、八卦图、莲台、蒲团。太吾对应：丹房、水火青炉、灶王玄鼎、化形·符箓、化形·拂尘、化形·冰笛。

### 灵植、灵兽与坐骑

- **灵植：** 灵芝、蟠桃、莲、紫竹、梧桐、古松。太吾：九曲紫竹、栖凤梧桐、龙盘根、活桃木、青菩提枝。
- **灵兽：** 仙鹤、白鹿、青牛、灵猴。
- **太吾代步：** 龙雀云船、麒麟华盖车、七香车、风后车、玄龙驭。它们很适合做“云上过境”的大资产。

### 仙人形象

道袍广袖、羽衣、高冠或莲花冠、拂尘、长须。女仙用披帛飘带、高髻。姿态是盘坐云上、踏剑、骑鹤。太吾衣着：老君袍、天师大氅、真武道袍、璇女灵裘。

### 特效要克制

- **祥云：** 如意形勾线云，用金或白。
- **霞光：** 只在天边一条。
- **御剑：** 一条细长剑影，后面拖一道白色气痕。
- **打坐：** 身边一圈淡金气环。
- **雷、火、法术：** 尽量不用。要用，就用古画式的墨线闪电和火焰纹。
- **发光只用金和白。** 不用霓虹紫、霓虹青。粒子少于画面 5%。

### 放置规则

1. 仙物放在高处：山顶、云上。
2. 仙物放在远处：远景层，半透明。
3. 仙气放在边缘：金线、云边、山脊。
4. 近景江湖场景里最多一件仙物，例如一只鹤或一缕祥云。

## 神话元素库（10%）

**神话层只放一个焦点，而且半隐。** 一张图最多一个神话主体。它可以在云里露一段身子，可以化成山形，也可以只是一块浮雕。造型参考汉画像石、青铜纹样和古籍木刻插图。

### 山海经异兽

《山海经》是公有领域古籍。下表是古籍描述的转述。

| 名 | 古籍里的样子 | 适合做 |
| --- | --- | --- |
| 应龙 | 有翼的龙，传说助黄帝作战 | 云中远景、山脊浮雕 |
| 烛龙（烛阴） | 人面蛇身，赤色；睁眼为昼，闭眼为夜 | 天边巨影；昼夜切换的神话依据 |
| 帝江 | 像黄色皮囊，红如火，六足四翼，没有面目，懂歌舞 | 奇遇里的怪物 |
| 穷奇 | 像虎，有翼 | 邪派图腾、凶兽 |
| 狰 | 像赤豹，五尾一角 | 山中恶兽 |
| 夔 | 像牛，青身无角，一足，声如雷 | 太吾有夔牛；也适合做鼓 |
| 驺吾 | 大如虎，五彩，尾比身长，可日行千里 | 仁兽坐骑 |
| 鹿蜀 | 像马，白头，虎纹，红尾，声如歌谣 | 白鹿一类的仙兽 |
| 文鳐鱼 | 鱼身鸟翼，夜里飞行 | 水面上的小奇观 |
| 九尾狐 | 青丘之山的九尾狐 | 夜景焦点 |
| 毕方 | 像鹤，一足，青色身上有红纹，白嘴 | 铸剑、火池一类场景 |

### 四象

青龙（东）、白虎（西）、朱雀（南）、玄武（北，龟蛇合体）。武当“龟蛇蟠扶”就是玄武。四象适合做门派图腾、瓦当和方位标志。

### 龙、凤、麒麟

- **龙：** 中国龙没有翼（应龙例外），身长如蛇，有角有须。通常只在云里露一段。不要画成西方有翼巨龙。
- **凤、鸾：** 长尾如飘带，适合做金线剪影。太吾有“凤凰台”“鸾凤羽”“凤凰茧”。
- **麒麟：** 仁兽。太吾有墨麒麟、麒麟蛟、麒麟华盖车。

**龙生九子可以直接做建筑装饰。** 常见说法（民间版本不一）：

| 名 | 放在哪里 |
| --- | --- |
| 囚牛 | 琴头 |
| 睨眦 | 刀剑柄 |
| 嘲风 | 殿角屋檐 |
| 蒲牢 | 钟钮 |
| 狻猊 | 香炉 |
| 霸下 | 驮石碑 |
| 狴犴 | 牢门 |
| 负屃 | 碑顶 |
| 螭吻 | 屋脊两端 |

### 太吾自己的神话层

- **相枢与剑冢、玄石与紫竹**：见“太吾绘卷词条”一节。
- **蛟：** 15 种蛟的名字就是视觉主题。焚山 = 火，披云 = 云，镇海 = 海，天雷 = 雷，渊下 = 深渊，仙山 = 化作山形。
- **异兽：** 黑山君、墨麒麟、九头蛇、三眼魈、搬山火龟、披星飞蜈、渊虬、芝人。

### 用量边界

1. 一张图最多一个神话主体。
2. 神兽体量大，但只露一部分：云中一段身子、山后一只眼、水下一片影。
3. 造型用古风线描：汉画像石、云雷纹、饕餮纹、古籍木刻插图。
4. 不画成萌宠：不用大眼睛，不用卡通比例。
5. 颜色仍在青绿体系里。神兽可以是墨色剪影加金线。

## 动植物与象征

**按寓意挑动植物，不按“可爱”挑。** 鸡、鸭、羊、兔、猫、狗不做主角，它们会把画面拉回农场。下表的“太吾关联”可以直接接到词条。

### 植物

| 植物 | 寓意 | 画法要点 | 纸艺做法 | 太吾关联 |
| --- | --- | --- | --- | --- |
| 松 | 长寿、坚贞、隐士 | 树干虬曲，针叶成团，长在崖边或石缝 | 深绿针团剪纸层层叠 | 林地、密林 |
| 竹 | 气节、清高 | 竿分节，叶成“个”“介”字形 | 叶片剪纸，竿用细纸条 | 九曲紫竹、静谧竹庐、玄石紫竹 |
| 桃 | 桃花源（避世）、辟邪、长寿 | 黑枝粉花，花开成片 | 粉色纸花簇 | 桃源地块、活桃木 |
| 桑 | 农桑、织造 | 低矮修剪的桑树成行，叶大 | 梯田式排布，配蚕室 | 桑园地块、彩桑园、天蚕丝 |
| 梅 | 傲寒、早春 | 黑枝折角，白或红小花 | 黑枝剪影加点花 | — |
| 柳 | 离别、江南 | 垂枝 | 细长纸条 | — |
| 莲 | 清净、佛 | 荷叶圆、莲瓣尖 | 圆叶剪纸 | 狮相门莲花山 |
| 梧桐 | 凤凰所栖 | 大叶、直干 | 大叶剪纸 | 栖凤梧桐 |
| 菩提 | 佛 | 心形叶 | — | 青菩提枝 |
| 灵芝 | 仙、长寿 | 云头形菌盖，有环纹 | 赭金色纸 | 天材地宝 |

### 动物

| 动物 | 寓意 | 画法要点 | 太吾关联 |
| --- | --- | --- | --- |
| 鹤 | 长寿、仙人坐骑；明清文官一品补子 | 丹顶，白身，颈和翅后缘黑；飞时颈腿伸直 | 仙层 |
| 虎 | 山君、威猛、镇邪 | 额上“王”字纹；画在岩上或松下 | 老虎、白虎、黑山君、搏虎牢、虎衣 |
| 孔雀 | 华美；密教孔雀明王；明清文官三品补子 | 尾屏眼斑正好是石青、石绿和金。中国本土是绿孔雀，产在云南 | 明王法衣；可配西域或云南 |
| 鹿 | 禄、长寿、仙鹿 | 白鹿最仙 | 百花谷“玄鸮白鹿”、四不像 |
| 猿 | 灵性 | 长臂挂树、坐在崖边 | 峨嵋“隐世白猿”、灵猴、英雄猴杰、猴儿酒 |
| 龟蛇 | 玄武、北方 | 蛇缠龟 | 武当“龟蛇蟠扶” |
| 鸮 | 夜、神秘 | 圆眼、正面、坐在枝上 | 百花谷“玄鸮” |
| 五毒 | 南方、毒、苗疆 | 蛇、蝎、蜈蚣、蟾蜍、壁虎做纹样 | 五仙教“五圣心毒”、披星飞蜈 |
| 狮 | 醒狮、镇宅 | 石狮成对守门 | 狮相门、金狮 |
| 牛 | 老子骑青牛出关 | 青牛低头慢行 | 青牛、牲牛、白牛 |
| 马 · 驴 | 江湖行旅 | 瘦马、灰驴、驮包袱 | 代步 |
| 蟋蟀 | 斗促织 | 瓦罐和斗盆 | 促织 |
| 鸦 | 荒凉、夜 | 枝头黑影 | 荒野、乱葬岗 |

**鹤、虎、孔雀正好对应三层。** 虎属江湖（山野、搏虎），鹤属仙（云上、坐骑），孔雀属华美与宗教（明王、金碧配色）。

## 色彩

**石青和石绿是主色，约占画面 60%；墨与纸是骨架，约 30%；赭与金约 7%；朱砂点睛不超过 3%。** papertrails 截图里取样的 6 个主色全是暖橙褐，这就是“田园温馨”的颜色来源。色值取自开源中国传统色清单（742 色）。

| 组 · 占比 | 色名 | HEX | 用在哪里 |
| --- | --- | --- | --- |
| 山与水 · 60% | 石青 | #2E5D8C | 峰尖、远山 |
| 山与水 | 群青 | #1772B4 | 深水、最远的山 |
| 山与水 | 花青 | #2376B7 | 水面、衣物 |
| 山与水 | 石绿 | #57C3C2 | 山腰、琉璃瓦 |
| 山与水 | 孔雀绿 | #229453 | 树冠、苔 |
| 山与水 | 海王绿 | #248067 | 松林、深谷 |
| 山与水 | 松墨 | #2E4B26 | 松针、阴面 |
| 墨与纸 · 30% | 墨色 | #1D1B1C | 小黑人、描边 |
| 墨与纸 | 松烟墨 | #3B3A3E | 皴线 |
| 墨与纸 | 玄青 | #2B3A4F | 夜色、邪派 |
| 墨与纸 | 黛 | #1A3A5F | 瓦、远山暗部 |
| 墨与纸 | 云青灰 | #8A9A9C | 雾、石 |
| 墨与纸 | 月白天青 | #C6D7DB | 天空、云 |
| 墨与纸 | 素积 | #D2C8BC | 纸底、墙 |
| 墨与纸 | 绫素白 | #F8F3E6 | 纸白、留白 |
| 赭与金 · 7% | 赭石 | #862617 | 山脚暗部、木构 |
| 赭与金 | 赭 | #BE7E4A | 土坡、树干 |
| 赭与金 | 秋香 | #C3B787 | 绢色、地面 |
| 赭与金 | 暗金 | #9C8B4D | 古金、铜器 |
| 赭与金 | 金棕 | #B8860B | 金线、金顶 |
| 点睛 · ≤3% | 朱砂红 | #D92121 | 印章、柱、灯笼 |
| 点睛 | 银朱 | #F43E06 | 火、符箓字 |
| 点睛 | 藤黄 | #FFD111 | 灯火、符纸 |
| 点睛 | 桃红 | #F0ADA0 | 桃花 |

### 参照：papertrails 的暖色

我对 papertrails 主截图做了 6 色聚类：#C19B52 31%、#954818 22%、#BE6624 18%、#98824B 13%、#543210 10%、#E4BD79 6%。六个都是橙褐和土黄。这些颜色只能放进“赭与金”的 7% 里，不能做主色。

### 昼夜与天气

- **白天：** 天从月白天青渐变到绫素白。阴影用云青灰，不用暖褐。
- **黄昏：** 只在天边加一条秋香或桃红的霞。不要把整张图染成橙色。
- **夜：** 天用玄青或黛，月用月白，山用群青剪影。灯笼用藤黄加朱砂的小点，面积不超过 1%。
- **雨 · 雾：** 整体压向云青灰，山的青绿降低饱和。米点皴最适合雨景。

**硬规则：暖色（赭、金、朱、桃）总面积不超过 10%。**

色板图（最后一行是 papertrails 的参照暖色）：

&#91;image: 青绿金碧色板：山与水 60%、墨与纸 30%、赭与金 7%、点睛 3%；最后一行是 papertrails 截图的暖色参照\]

## 构图与镜头

**用“三远”和“长卷”组织画面：近处是江湖，中间是云带，远处是仙山。** 画面至少 30% 留白。人要小，山要大。

### 三远（北宋郭熙《林泉高致》）

> 自山下而仰山巅，谓之高远；自山前而窥山后，谓之深远；自近山而望远山，谓之平远。高远之色清明，深远之色重晦，平远之色有明有晦。

| 远 | 视角 | 气氛 | 用在哪里 | 英文提示词 |
| --- | --- | --- | --- | --- |
| 高远 | 从山下仰望山顶 | 清明 | 门派主峰、凌云阶、剑冢入口 | low-angle view up a towering cliff |
| 深远 | 从山前看进山后 | 重晦 | 峡谷、洞府、秘境 | looking deep into layered valleys |
| 平远 | 从近山望远山 | 有明有晦 | 驿道、江面、长卷背景 | level view across distant ranges |

### 长卷与散点透视

- 《千里江山图》近 12 米，用散点透视和鸟瞰。画面没有单一消失点。
- papertrails 的“无尽立体书”可以改成“无尽长卷”。每一页是一段长卷。
- 古代手卷从右往左展开。游戏可以从左往右走，但每一段内部建议按“平远开场 → 高远主峰 → 深远秘境 → 平远收尾”排列。

### 分层（立体书的纸层）

| 纸层 | 内容 | 颜色 | 画面占比（建议） |
| --- | --- | --- | --- |
| 1 前景 | 松枝、石块、栏杆，部分出画 | 墨、赭、深绿 | 10% |
| 2 近景 | 江湖建筑、人物、道具 | 全色 | 30% |
| 3 中景 | 山腰、云带、门派台地 | 石绿、云白 | 25% |
| 4 远景 | 主峰、仙阁 | 石青 | 20% |
| 5 天 | 留白、远山剪影、一条霞或一轮月 | 月白、纸白 | 15% |

### 留白、云带、动线

- 天、云、水、雾都算留白。合计至少 30%。
- 云带放在画高的 1/3 或 2/3 处，横切山体。
- 不要每块地都放东西。一块空地比一辆南瓜车更“仙”。
- 用 S 形山路或溪流把视线从近景引到远峰。小人走在栈道、石阶、桥上。
- 山水里人很小。建议小黑人在长卷背景里约占画高的 1/20 到 1/40。

### 两种镜头

| 用途 | 镜头 | 英文提示词 |
| --- | --- | --- |
| 地块资产 | 等距 3/4 俯视，立方体断崖底座（太吾地格式） | isometric 3/4 view, single cuboid tile block with cliff sides |
| 场景背景 | 侧视长卷，散点透视 | side-view handscroll panorama, scattered perspective |

### 光

- 古画没有投影。纸模型可以有柔和的接触阴影，但不要强烈的金色斜阳。
- 光从上方或左上方来，偏冷，散射。
- 移轴微缩可以保留，但模糊区用雾来代替，而不是暖色光晕。

## 小人练功与对战姿势

**小人用纯黑剪影（太吾小黑人式）或皮影式关节剪影。姿势要一眼读出“功夫”：重心低、四肢舒展、轮廓不粘连。** 动画实现见前一份文档《太吾绘卷经典版小黑人战斗动画复刻调研》。

### 剪影规则

1. 四肢和躯干之间留空隙。粘在一起的剪影读不出动作。
2. 用侧面或 3/4 侧面。正面剪影读不出动作。
3. 武器延长身体的线。剑和枪要整根露在轮廓外。
4. 用发带、衣摆、剑穗表现风和速度。
5. 约 6–7 头身。不要 Q 版大头。
6. 头部轮廓带身份：发髻、斗笠、僧人光头、道冠。

### 基本步型

| 姿势 | 要点 | 英文 |
| --- | --- | --- |
| 马步 | 两脚宽于肩，屈膝半蹲，大腿接近水平 | horse stance |
| 弓步 | 前腿屈膝，后腿蹬直 | bow stance |
| 虚步 | 重心在后腿，前脚尖点地 | empty stance |
| 仆步 | 一腿全蹲，另一腿平铺伸直 | drop stance |
| 独立步（金鸡独立） | 单腿站立，另一腿提膝 | one-leg crane stance |
| 站桩 | 两脚平行，双臂在胸前环抱 | standing post, arms circled as if hugging a tree |

### 五禽戏（华佗）

| 禽 | 手型 | 两个动作 | 剪影要点 |
| --- | --- | --- | --- |
| 虎 | 虎爪 | 虎举、虎扑 | 上身前探，双手成爪 |
| 鹿 | 鹿角 | 鹿抵、鹿奔 | 腰向侧拧或弓背前伸 |
| 熊 | 熊掌 | 熊运、熊晃 | 身体沉重，左右晃 |
| 猿 | 猿钩 | 猿提、猿摘 | 踮脚缩颈，一手上伸摘果 |
| 鸟 | 鸟翅 | 鸟伸、鸟飞 | 单腿站，双臂展开如翅 |

### 拳掌与礼

- **抱拳礼：** 右手握拳，左掌掩住拳面，举在胸前。
- **拳掌：** 冲拳、推掌、劈掌、亮掌（掌举过头侧）。
- **起势 · 收势：** 双手缓缓下按。

### 兵器架势

| 兵器 | 架势 | 剪影要点 |
| --- | --- | --- |
| 剑 | 持剑礼（剑贴前臂背后）、弓步直刺、剑指、提膝举剑、旋身劈剑 | 剑身整条露出，剑指为食指中指并拢 |
| 刀 | 缠头裹脑、抱刀、劈刀 | 刀背和刀刃方向要清楚 |
| 枪 | 拦、拿、扎；立枪 | 枪杆和身体成对角线 |
| 棍 | 舞花、扫棍、立棍 | 棍长约齐眉 |
| 扇 · 笛 · 琴 | 开扇、横笛、膝上拚琴 | 文人兵器，姿态松 |
| 暗器 | 侧身甩手 | 手在身后，暗器飞出一条细线 |

### 内功与轻功

- **打坐：** 盘膝，双手叠在腹前或结印。
- **吐纳：** 双手掌心向上托起，身体微仰。
- **轻功：** 腾空跃起、踏水、竹梢单足立、檐角奔跑、凌空翻身。

### 对战构图

- **对峙：** 两人相距，兵器相指，中间留空。
- **交手：** 兵器相交成 X 形。
- **一击：** 攻者弓步前刺，受者后仰。
- **群战：** 一人居中，四周人影环绕。

### 训练道具

木人桩、梅花桩、石锁、沙袋、箭靶、兵器架、铜人。太吾对应：练功房、桩林、木人阵、铜人阵、演武场。

## GPT 生图提示词

**一条提示词 = 媒介 + 主体 + 层级 + 色板 + 构图 + 光 + 避免项。** 先写媒介，再写具体物件。不要只写“中国风”。ChatGPT 生图没有单独的负面提示词框，把避免项写在最后一句“Avoid: …”。

### 通用模板（英文）

```text
MEDIUM: Layered paper-cut pop-up diorama on handmade xuan paper, visible paper fibers, torn deckle edges on mountains, clean cut edges on buildings, fine ink outlines.
SUBJECT: {asset}, in a Song-dynasty Chinese wuxia world.
LAYERS: wuxia details: {...}. Xianxia accent only at the top or far edge: {one accent}. Myth: {none | one half-hidden element}.
PALETTE: blue-green landscape palette — azurite blue #2E5D8C, malachite green #57C3C2, pine-ink green #2E4B26, ink black #1D1B1C, rice-paper white #F8F3E6; ochre #BE7E4A only on mountain bases and wood; a thin gold line #B8860B on ridges; one small cinnabar red #D92121 accent.
COMPOSITION: {isometric 3/4 view of one cuboid tile with cliff sides | side-view handscroll panorama, scattered perspective}; at least 30% empty mist and paper white.
LIGHT: cool diffuse overcast light, morning mist, soft contact shadows.
Avoid: {negative list}.
```

### 通用模板（中文）

```text
【媒介】手工宣纸上的多层剪纸立体书模型，可见纸纤维；山体是撕纸毛边，建筑是干净切边；细墨线勾边。
【主体】{资产}，宋代武侠世界。
【层级】武侠细节：{…}。仙气只放在顶部或远处：{一件}。神话：{无 / 一个半隐元素}。
【色板】青绿山水：石青、石绿、松墨、墨黑、宣纸白为主；赭石只在山脚和木构；山脊一条细金线；一处朱砂点睛。
【构图】{等距 3/4 视角单块地块，立方体断崖底座 / 侧视长卷，散点透视}；至少 30% 留白云雾。
【光】清冷散射光，晨雾，柔和接触阴影。
【避免】{负面词}
```

### 分资产示例

**1. 门派地块（武当，江湖 + 一点仙）**

```text
Isometric 3/4 view of one cuboid tile shaped as a sheer cliff block, ochre at the base, malachite slopes, azurite at the top, ink-outlined layered xuan paper. On top: a small Taoist temple complex climbing the slope on stone steps, hip-and-gable roofs with deep eaves and large dougong brackets, a gilded hall at the summit, a turtle-and-snake relief on the gate. A thin mist band wraps the cliff. Gold only on the summit ridge. Isolated on plain paper-white background, no text. Avoid: cottage, red scalloped roofs, meadow, warm glow.
```

**2. 客栈（江湖）**

```text
Paper-cut pop-up diorama of a two-storey wooden roadside inn on a mountain post road. Overhanging gable roof with grey tiles, a long blank cloth wine banner, a lean horse at the hitching post, a sword leaning by the door, a pine on a rock behind, fog in the valley below. Cool overcast light. Palette: ink, grey-blue tiles, malachite pine, ochre wood, one cinnabar lantern. Avoid: cozy cottage, flower boxes, picket fence, warm window light, text.
```

**3. 练功场加小黑人（江湖）**

```text
Side view of a martial training yard on a cliff terrace, layered paper diorama: wooden dummies, plum-blossom stakes of different heights, stone locks, a weapon rack with spear, staff and sword. Three pure black silhouette figures, 6-7 heads tall, clear gaps between limbs: horse stance, bow stance with a straight-sword thrust, one-leg crane stance. Mist band behind, azurite peaks far away. Avoid: chibi, cute, farm animals.
```

**4. 长卷背景（山为主）**

```text
Side-view handscroll panorama of a Song-dynasty blue-green landscape, built from layered paper cutouts: ochre bases rising into malachite slopes and azurite peaks, axe-cut texture strokes on the cliffs, horizontal mist bands cutting the mountains, a two-tier waterfall, a winding post road with a small stone arch bridge and a pavilion. Scattered perspective, 40% empty paper-white mist, thin gold lines on the main ridges. Avoid: rolling meadows, round hills, autumn orange.
```

**5. 仙山云海（20% 层）**

```text
Far-distance layer: a lone needle peak rising from a sea of clouds, a small pavilion with a pyramidal roof on top, a long stone stairway climbing into the clouds, two red-crowned cranes flying with necks stretched straight. Clouds drawn as ruyi-shaped outline clouds in white and thin gold. Translucent paper layers, very soft. Avoid: neon glow, particles, purple magic.
```

**6. 神话焦点（10% 层）**

```text
A colossal Chinese jiao dragon (serpentine, horned, no wings) half hidden in mist behind a mountain range; only one coil and the head show. Drawn in ink line like a Han-dynasty stone relief, ink-black body with a thin gold outline, blue-green mountains in front. Only one mythic element. Avoid: western winged dragon, cute, cartoon eyes.
```

**7. 桃源地块（防温馨）**

```text
Isometric tile: a hidden valley reached through a narrow cave mouth in an azurite cliff. Inside: a few peach trees in pink bloom along a clear stream, a stone slab bridge, one small grey-tiled pavilion, mist. Quiet and remote, like the Peach Blossom Spring story. Avoid: farm, crop fields, fences, barn, animals, cottage.
```

**8. 桑园地块（防温馨）**

```text
Isometric tile: terraced mulberry trees on a steep slope held by dry-stone walls, an open silk-reeling shed with round bamboo trays of silkworms, mist drifting across the terraces, a stone stele by the path, sheer cliff edges on the tile sides. Avoid: barn, pumpkins, hay, fences, cozy farm.
```

**9. 道具图集**

```text
Sprite sheet on a plain paper-white background, same 3/4 view and top-left light for every item, items well separated: weapon rack, wooden training dummy, stone stele on a turtle base (bixi), stone lantern with a hip-roof cap, red lantern post, bamboo fence segment, blank escort banner, sword stuck in the ground, lingzhi cluster, incense burner with a lion lid. Paper-cut style, ink outlines, blue-green palette. No text.
```

**10. 小黑人姿势图**

```text
Character pose sheet: one pure black silhouette martial artist, same proportions in every pose, side view, clear negative space between limbs, hair ribbon and robe hem flowing. Poses: horse stance, bow-stance punch, bow-stance sword thrust, one-leg crane stance, tiger pounce, bird flying, seated meditation, leaping qinggong. White background, evenly spaced, no text.
```

### 中英词库

| 类别 | 中文 | 英文 |
| --- | --- | --- |
| 媒介 | 宣纸、剪纸、皮影、拓片、立体书 | xuan paper, paper-cut, shadow-puppet leather, ink rubbing, pop-up book |
| 山 | 青绿山水、斧劈皴、披麻皴、米点、腰云、云海、孤峰、断崖、栈道、叠瀑 | blue-green landscape, axe-cut strokes, hemp-fiber strokes, Mi dots, mist band, sea of clouds, needle peak, sheer cliff, cliffside plank road, tiered waterfall |
| 建筑 | 歇山顶、庑殿顶、攒尖顶、斗拱、飞檐、鸱尾、牌坊、山门、楼阁、塔、吊脚楼、马头墙 | hip-and-gable roof, hip roof, pyramidal roof, dougong brackets, upturned eaves, chiwei ridge ornament, paifang gateway, temple gate, tiered pavilion, pagoda, stilt house, horse-head gable wall |
| 江湖 | 客栈、镖局、擂台、驿站、关隘、酒旗、兵器架、木人桩、梅花桩 | roadside inn, escort agency, martial arena, post station, mountain pass gate, wine banner, weapon rack, wooden dummy, plum-blossom stakes |
| 仙 | 祥云、丹炉、葫芦、拂尘、飞剑、符箓、洞府 | ruyi clouds, alchemy cauldron, gourd, horsetail whisk, flying sword, talisman paper, immortal's cave |
| 神 | 蛟、应龙、麒麟、玄武、饕餮纹、云雷纹、汉画像石 | jiao dragon, winged yinglong, qilin, turtle-and-snake Black Tortoise, taotie motif, cloud-and-thunder pattern, Han stone relief |
| 动植 | 松、竹、桃、桑、灵芝、丹顶鹤、虎、绿孔雀、白鹿、白猿 | pine, bamboo, peach blossom, mulberry, lingzhi, red-crowned crane, tiger, green peafowl, white deer, white ape |
| 人 | 剪影侠客、斗笠、交领右衽、马步、弓步、抱拳礼 | black silhouette swordsman, conical bamboo hat, cross-collar robe, horse stance, bow stance, fist-and-palm salute |
| 光 | 阴天散射光、晨雾、月光 | overcast diffuse light, morning mist, cool moonlight |

### 负面词

```text
Avoid: cozy, cottage, farmhouse, barn, windmill, hay bales, pumpkin, picket fence, paddock fence, beehive, mushroom house, European village, fairytale village, church, manor, rolling green meadows, round hills, autumn orange palette, golden hour, warm window glow, chibi, kawaii, big eyes, cute farm animals, Japanese torii, Japanese castle, kimono, katana, samurai armor, western winged dragon, neon glow, glowing particles, purple magic, game UI, text, letters, watermark.
```

中文版：温馨、农舍、谷仓、风车、草垛、南瓜、白栅栏、欧洲村庄、童话小镇、教堂、绿色缓坡、圆山丘、秋天橙色调、金色夕阳、窗内暖光、Q 版、萌宠、日式鸟居、和服、武士刀、有翼西方龙、霓虹光、粒子特效、文字、水印。

### 使用技巧

1. **先做风格母版。** 做一块地块和一段长卷。满意后把它们当参考图，后面每次都附上。
2. **一次只换一个变量。** 只换门派，或只换天气。
3. **写具体名词。** 写“歇山顶、斗拱、酒旗”，不写“中国风建筑”。
4. **色板写颜色名加 HEX。**
5. **不让 GPT 写字。** 牌匾和旗子留空，以后自己加。
6. **要单独资产，就写 “isolated on plain paper-white background, evenly spaced”。** 之后自己抠图。
7. **参考图用公有领域古画。** 例如《千里江山图》《江山秋色图》《桃源仙境图》的高清扫描。不要把太吾的美术图直接喂给 GPT 做要发布的资产。
8. **每生成 10 张，按 7/2/1 数一次。** 江湖、仙、神各几张？超了就删或重做。

## 资产清单映射

**papertrails 有 48 种地块和 183 张精灵图。下表把每一个换成武侠仙侠对应物，并标出层。** “删”表示直接去掉，不找替代。名字取自仓库的 assets\_meta.json 和 atlas.json。

### 地块（48 种）

| papertrails 地块 | 换成 | 层 |
| --- | --- | --- |
| meadow · meadow\_flowers | 原野：石坡、稀草、一块界碑；不铺花毯 | 江湖 |
| hills | 丘陵：层叠断崖小丘，不是圆丘 | 江湖 |
| forest | 林地：松林 | 江湖 |
| grove | 竹林或园林 | 江湖 |
| deep\_pines | 密林、太始林 | 江湖 · 仙 |
| rocks | 石林、乱石堆 | 江湖 |
| pond | 湖泊、莲池、洗剑池 | 江湖 |
| river\_straight · river\_corner · river\_source | 溪涧 · 江湾 · 山泉加叠瀑 | 江湖 |
| river\_reeds | 芦苇渡口、乌篷船 | 江湖 |
| bridge | 石拱桥、廊桥 | 江湖 |
| path\_straight · path\_corner · path\_t · path\_cross · path\_end | 驿道、石板路、石阶；路尽头放界碑或山门 | 江湖 |
| lantern\_post | 中式石灯、灯笼柱 | 江湖 |
| windmill | 筒车、水排 | 江湖 |
| house · village · village\_b | 民居、村、乡、镇、驿 | 江湖 |
| village\_green · market\_square | 市集空地、擂台 | 江湖 |
| watchtower | 望楼、烽火台、关隘 | 江湖 |
| church | 道观、禅寺（门派） | 江湖 |
| barn\_farm | 镖局、仓廩 | 江湖 |
| manor | 宅院、太吾氏祠堂 | 江湖 |
| blossom\_orchard | 桃源 | 仙 |
| blossom\_garden | 药圃、花谷 | 江湖 · 仙 |
| blossom\_gazebo | 攒尖亭 | 江湖 |
| blossom\_lane | 桃花溪 | 仙 |
| mushroom\_glade | 灵芝崖、药园 | 仙 |
| fallen\_log | 枯木、荒野 | 江湖 |
| snow\_pines · snow\_drifts | 雪松林 · 雪原 | 江湖 |
| snow\_cabin · snow\_hamlet | 林中药庐（空桑）· 关外村寨 | 江湖 |
| frozen\_pond | 玄冰（太吾资源点） | 仙 |
| desert\_dunes · desert\_dunes\_b · desert\_dunes\_c | 西域沙丘、戈壁 | 江湖 |
| desert\_cacti | 胡杨、红柳 | 江湖 |
| desert\_camp | 驼队营地、毡帐 | 江湖 |
| desert\_oasis | 绿洲、月牙泉 | 江湖 |
| desert\_market | 西域胡市（商贾云集） | 江湖 |
| desert\_ruin | 古城遗址、烽燧 | 江湖 |

### 精灵图（183 张，按类）

| papertrails 精灵 | 换成 | 层 |
| --- | --- | --- |
| houses\_0–10 · cabin\_front/side/roof | 民居、客栈、茶棚（悬山、硬山顶） | 江湖 |
| barn\_front/side/roof · granary\_0 | 镖局、仓廩 | 江湖 |
| manor\_front/side | 宅院、祠堂 | 江湖 |
| church\_front\_0 | 山门、殿宇正面 | 江湖 |
| stone\_tower\_0 · watchtower\_0 · water\_tower\_0 | 塔 · 望楼 · 水排 | 江湖 |
| stilt\_cabin\_0 | 吊脚楼（五仙教） | 江湖 |
| tent\_0–2 | 毡帐（西域）、镖队营帐 | 江湖 |
| gazebo\_0 | 亭 | 江湖 |
| greenhouse\_0 | 丹房、养药室 | 仙 |
| igloo\_0 | 冰窟 | 仙 |
| ziggurat\_0 | 祥天高台 | 神 |
| structures\_0–7 · extras\_0–8 | 牌坊、山门、石碑、经幢等；逐张对照原图再定 | — |
| trees\_a\_0–5 · trees\_b\_0–5 | 松、柏、柳、点叶杂树 | 江湖 |
| birch\_0–1 | 白皮松 | 江湖 |
| darkpine\_0–3 · snowpine\_0–4 | 虬干古松 · 雪松 | 江湖 |
| blossom\_tree\_0–1 · blossom\_tree\_white\_0–1 | 桃 · 白梅 | 仙 |
| palm\_0–1 | 芭蕉 | 江湖 |
| cactus\_0–1 · barrel\_cactus\_0–1 · prickly\_pear\_0 | 胡杨、红柳、骆驼刺 | 江湖 |
| dead\_tree\_0 · stump\_0–1 · mossy\_log\_0 | 枯树、树桩 | 江湖 |
| bushes\_0–7 · fern\_0–1 · thorn\_bush\_0–1 · snowbush\_0–1 | 竹丛、蕨、荆棘 | 江湖 |
| wisteria\_arch\_0 | 紫藤架 | 江湖 |
| flower\_bed\_0–1 · desert\_flowers\_0–1 | 药圃畦、少量野花 | 江湖 |
| giant\_mushroom\_0–2 | 巨型灵芝 | 仙 |
| mountains\_rocks\_0–7 · hills\_0–3 | 斧劈皴山石、孤峰、石笋 | 江湖 |
| mossy\_boulder\_0–1 · ice\_rock\_0 | 太湖石、苔石 · 冰石 | 江湖 |
| dune\_0–1 · snowdrift\_0 | 沙丘 · 雪堆 | 江湖 |
| cloud\_0–2 | 如意云、云带 | 仙 |
| smoke\_0–2 | 香炉烟、炊烟（少量） | 江湖 |
| kite\_0 | 纸鸢 | 江湖 |
| bird\_0–1 · bird\_fly\_0–2 | 鹤 · 鸦 · 鹰 | 仙 · 江湖 |
| deer\_0 | 白鹿 | 仙 |
| cow\_0 | 青牛 | 仙 |
| camel\_0 | 骆驼（西域驼队） | 江湖 |
| fox\_0 | 九尾狐（只在夜景） | 神 |
| duck\_0–1 · butterfly\_0–1 | 白鹭 · 蝶（少量） | 江湖 |
| cat\_0 · dog\_0 · hen\_0 · rabbit\_0–1 · sheep\_0–1 | 删；需要动物时换成猿、远景虎 | — |
| awning\_stall\_0 · market\_stall\_0 | 茶棚、摊棚 | 江湖 |
| barrel\_0 · barrels\_0 · crates\_0 · crate\_stack\_0 · clay\_pots\_0 | 酒坛、镖箱、药箱 | 江湖 |
| beehive\_row\_0 | 晒药架、蚕匁架 | 江湖 |
| bench\_0 · picnic\_0 | 石凳 · 茶席 | 江湖 |
| bunting\_0 | 镖旗、经幡 | 江湖 |
| desert\_well\_0 | 井（可做龙泉七星井） | 江湖 |
| fountain\_0 | 洗剑池 | 江湖 |
| guidepost\_0–1 | 界碑、指路石 | 江湖 |
| hay\_bales\_0 | 石锁、木人桩 | 江湖 |
| hay\_cart\_0 · pumpkin\_cart\_0 | 镖车 · 独轮车 | 江湖 |
| lamp\_post\_0–1 | 灯笼柱 | 江湖 |
| laundry\_line\_0 | 染坊晒布架 | 江湖 |
| paddock\_fence\_0 · snow\_fence\_0 | 竹篱 · 石栏 | 江湖 |
| rope\_bridge\_0 | 索桥（保留） | 江湖 |
| sled\_0 | 竹板橇（太吾代步） | 江湖 |
| snowman\_0 | 删 | — |
| stone\_lantern\_0 | 中式石灯（歇山小帽，不要日式） | 江湖 |
| woodpile\_0 | 柴堆（少量） | 江湖 |
| traveller（三角纸片） | 黑色剪影侠客 | 江湖 |

### papertrails 没有、建议新增的资产

- **江湖：** 15 个门派山门地块、关寨、桩林、试剑台、峡谷栈道。
- **仙：** 云海孤峰、洞府、凌云阶、琉璃索、龙雀云船（大型移动资产）。
- **神：** 剑冢、玄石紫竹、暗渊、蛟。蛟每一段长卷最多一只。

## 来源

标为“建议”的内容（生图关键词、配比、层级、映射）是本文的设计建议，不是出处原文。

**项目与游戏**

- [xikhar/papertrails](https://github.com/xikhar/papertrails)（README、package.json、assets\_meta.json、atlas.json、截图）
- [太吾绘卷灰机 wiki 首页](https://taiwu.huijiwiki.com/wiki/%E9%A6%96%E9%A1%B5)、[门派](https://taiwu.huijiwiki.com/wiki/%E9%97%A8%E6%B4%BE)、[地图](https://taiwu.huijiwiki.com/wiki/%E5%9C%B0%E5%9B%BE)、[建筑](https://taiwu.huijiwiki.com/wiki/%E5%BB%BA%E7%AD%91)、[相枢](https://taiwu.huijiwiki.com/wiki/%E7%9B%B8%E6%9E%A2)；另有地块、奇遇、野兽与神龙、代步、衣着、材料等词条
- [TapTap：太吾绘卷玩家评价](https://www.taptap.cn/app/862470/review)
- [TapTap：《淡墨水云乡》评价](https://www.taptap.cn/review/38655813)

**青绿山水与颜料**

- [人民日报：《千里江山图》的矿物颜料](https://paper.people.com.cn/rmrbwap/html/2024-07/29/nw.D110000renmrb_20240729_2-15.htm)
- [IT之家：石绿](https://www.ithome.com/0/653/611.htm)
- [网易：《千里江山图》的三远与景物](https://163.com/dy/article/HOUR2O8Q0514BMG0.html)
- [头条：《千里江山图》长卷与散点透视](https://www.toutiao.com/zixun/7546813052646098994/)
- [新浪：赵伯驹《江山秋色图》](https://finance.sina.cn/2022-11-03/detail-imqqsmrp4821033.d.html)
- [澎湃：仇英《桃源仙境图》](https://www.thepaper.cn/newsDetail_forward_1591084)
- [芝加哥艺术博物馆：桃花源长卷](https://www.artic.edu/artworks/75361)
- [中国传统色清单（742 色）](https://github.com/nevertoday/zhongguo-traditional-colors)

**皴法与构图**

- [澎湃：皴法分类](https://www.thepaper.cn/newsDetail_forward_11364194)
- [JAANUS：斧劈皴](https://projects.mcah.columbia.edu/jaanus/record/fuhekishun)、[JAANUS：披麻皴](https://projects.mcah.columbia.edu/jaanus/record/himashun)
- [网易：张大千谈皴法](https://c.m.163.com/news/a/L2FDGULC0514BNHE.html)
- [Aisthesis：郭熙“三远”原文与研究](https://mimesisjournals.com/ojs/index.php/aisthesis/article/download/4221/3320)

**建筑**

- [搜狐：古建筑屋顶等级](https://www.sohu.com/a/157159164_488901)
- [我们的中国故事：屋顶形制](https://www.ourchinastory.com/cn/11993)
- [B 站：柳肃讲中国建筑的院落与中轴](https://www.bilibili.com/opus/762923399002456064)

**姿势与神话**

- [搜狐：五禽戏手型](https://www.sohu.com/a/319973997_488226)、[头条：五禽戏动作](https://www.toutiao.com/zixun/7512996932902750217/)
- [萌娘百科：山海经](https://mzh.moegirl.org.cn/%E5%B1%B1%E6%B5%B7%E7%BB%8F)、[澎湃：山海经异兽](https://m.thepaper.cn/newsDetail_forward_24058569)、[搜狐：烛龙](https://www.sohu.com/a/377737323_173129)
