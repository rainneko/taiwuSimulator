# 搁置：折纸纸盒房屋（M3-WO3 v1.3，2026-11-24 搁置）

v1.3 的方案是程序搭纸盒、贴 GPT 画的平面部件（HouseBuilder）。用户看了预览后认为纸盒房子和手绘插画立牌风格不搭，v1.3.1 改为单栋房屋立牌（工单 §3.12）。这里是改动前的完整副本，只作存档，不参与构建与测试：

- `wo-v1.3-section-3.12.md`：工单 v1.3 的 §3.12「折纸房屋」原文（几何、原型参数、贴图 UV、摆放配方）。
- `build_house_kit.py`：房屋部件图集（19 帧，可平铺帧按环绕外扩、UV 半 texel 内缩）。依赖 `tools/art/artlib.py`，要运行须拷回 `tools/art/`。
- `preview_grid.py`：当时的静态预览，含纸盒房屋的绘制（`house_faces` / `draw_house` / `load_house_kit`、落影凸包）。
- `region_prompts.py`：当时的生成器，含 J 类 19 张部件 prompt（`FACE_STYLE` / `HOUSE_FACE` / `HOUSE_PARTS`）。
- `test_v13.py`：当时的测试，含 `HouseTest`（纸盒版）与 `HouseKitTest`。

要恢复「可旋转的立体房子」时从这里拷回再对齐当前的 `tools/art/`。
