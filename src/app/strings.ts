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
  'field.look': '外观', 'look.a': '布衣', 'look.b': '侠客', 'points.left': '剩余点数',
};
export function t(key: string): string { return zh[key] ?? key; }
