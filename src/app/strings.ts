const zh: Record<string, string> = {
  'menu.continue': '继续', 'menu.new': '新的传承', 'menu.load': '读取存档', 'menu.settings': '设置', 'menu.credits': '鸣谢',
  'menu.title': '太吾绘卷', 'common.back': '返回', 'common.close': '关闭', 'common.prev': '上一步', 'common.next': '下一步',
  'common.finish': '开始', 'common.retry': '重试', 'common.cancel': '取消', 'loading': '加载中…',
  'settings.title': '设置', 'settings.quality': '画质', 'settings.motion': '减少动效', 'settings.volume': '音量',
  'quality.high': '高', 'quality.medium': '中', 'quality.low': '低',
  'saveLoad.title': '存档', 'saveLoad.empty': '暂无存档', 'credits.title': '鸣谢',
  'wizard.step.char': '人物', 'wizard.step.birth': '出生地', 'wizard.step.world': '世界设定',
  'wizard.birth.placeholder': '世界地图选点（待 WO2 接入）',
  'field.surname': '姓', 'field.given': '名', 'field.gender': '性别', 'gender.m': '男', 'gender.f': '女',
  'field.age': '年龄', 'field.attrs': '属性分配', 'attr.str': '膂力', 'attr.agi': '灵敏', 'attr.int': '悟性', 'attr.con': '体质',
  'field.difficulty': '难度', 'diff.easy': '简单', 'diff.normal': '普通', 'diff.hard': '困难',
  'field.worldSize': '世界大小', 'size.small': '小', 'size.medium': '中', 'size.large': '大',
  // 大地图（M3-WO2）：省名占位取原版地名表 id 1–15，对应 MapPlace0–14
  'province.0': '京城', 'province.1': '成都', 'province.2': '桂州', 'province.3': '襄阳', 'province.4': '太原', 'province.5': '广州', 'province.6': '青州', 'province.7': '江陵', 'province.8': '福州', 'province.9': '辽阳', 'province.10': '秦州', 'province.11': '大理', 'province.12': '寿春', 'province.13': '杭州', 'province.14': '扬州',
  'region.capital': '州府', 'region.sect': '门派', 'region.rural': '乡野',
  'map.ap': '行动力', 'map.go': '前往', 'map.goodwill': '恩义', 'map.unreached': '未通', 'map.apShort': '行动力不足',
  'map.home': '所在', 'map.back': '返回大地图', 'map.locked.reason': '此地尚未开放',
  'map.layer.faction': '势力', 'map.layer.goodwill': '恩义', 'map.layer.routes': '驿路',
  'field.look': '外观', 'look.a': '布衣', 'look.b': '侠客', 'points.left': '剩余点数',
};
export function t(key: string): string { return zh[key] ?? key; }
