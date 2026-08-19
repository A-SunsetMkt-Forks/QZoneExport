# -*- coding: utf-8 -*-
"""生成 QZoneExport V3 发版公告 SVG 海报（矢量、中文清晰）。"""
import xml.etree.ElementTree as ET

W = 820
PAD = 40
USABLE = W - 2 * PAD

ACCENT = "#4f46e5"
ACCENT2 = "#7c3aed"
HEADER_TOP = "#5b4bdb"
HEADER_BOT = "#7c3aed"
CARD_BG = "#ffffff"
CARD_BORDER = "#e6e8f0"
BODY = "#3a3f4b"
TITLE = "#1f2330"
SUB = "#6b7280"
VALUE = "#6366f1"

FONT = "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC','Hiragino Sans GB',sans-serif"

sections = [
    {
        "title": "一、核心亮点",
        "kind": "numbered",
        "items": [
            "升级到新版扩展标准（Manifest V3），整体更现代、更稳定，长期可用性与安全性更好。",
            "全新离线备份查看器：备份变成一个可本地打开的查看应用，新增数据看板、互动关系分析、足迹地图等。",
            "默认备份方式改为「直写目录」，大空间备份更稳、可续传。",
            "设置页、弹窗、查看器全面改版，排版更清晰、手机端更好用。",
        ],
    },
    {
        "title": "二、新增功能",
        "kind": "bullets",
        "items": [
            "全新离线备份查看器：一个本地可直接打开的查看应用，支持全部内容类型浏览、足迹地图、一键升级旧备份等。价值：备份后查看体验从「静态网页」升级为「可交互应用」，并解锁下方所有新分析能力。",
            "空间数据看板（主页）：一屏掌握全貌——总览条、环形图、互动热度、媒体统计、月度热力图、空间之最、最常访问地点等。价值：不用翻页就能快速回顾整个 QQ 空间的全景。",
            "互动关系分析：与好友的「共同会话数 / 回应率 / 互动总量」、初识与重逢时间线、「我与 TA 的互动」独立明细页、回应率统计；他人空间会自动隐藏无关模块。价值：把零散互动沉淀为可读的关系图谱，怀旧与社交回顾更有温度。",
            "直写目录备份模式：可选择目标文件夹，边采集边写入、自动去重。价值：超大空间备份不再依赖单个压缩包，落盘更稳妥。",
            "断点续传：备份中途中断（如关闭浏览器、断网）后，再次启动可从断点继续，不必从头重跑；已完成的模块不会被重复采集。价值：大空间备份更安心，意外中断后能接着做，不浪费已下载的内容。",
            "首次使用引导：安装欢迎页 + 弹窗分步引导 + 页面内提示。价值：第一次用也能按引导顺利完成备份，降低上手门槛。",
            "远程预设 + 常用设置快捷切换：内置推荐配置可直接套用，常用设置一键切换。价值：少调参数也能获得较优备份效果。",
            "设置页批量开关与辅助项：点赞 / 评论 / 访客等可批量开关注；密钥支持密文显示；腾讯地图链接直达；给出「推荐配置组合」提示。价值：批量管理与安全查看更省心。",
            "全模块头像本地化下载：评论用户、侧边栏等头像一并备份到本地。价值：离线打开备份时也能正常显示头像，不依赖头像服务器。",
            "相册 / 相片瀑布流展示：查看器内可在「分页列表 / 瀑布流」间切换，且选择会被记住。价值：照片多的相册浏览更顺手，符合个人习惯。",
            "下载管理增强：支持模块级媒体下载、下载器连通性预检、媒体列表「复制下载链接」、操作按钮改为纯图标 + 悬浮提示。价值：大批量下载更可控、排错更快。",
        ],
    },
    {
        "title": "三、配置与行为变更",
        "kind": "bullets",
        "items": [
            "下载方式精简：移除「助手内部 File 下载模式」与「迅雷下载器」（含迅雷任务数、迅雷间隔等配套配置）。下载方式仅保留 助手直写目录 / 浏览器下载器 / Aria2 协议下载器 三种；原 Aria2 与 Motrix 两种称谓合并为「Aria2 协议下载器」。",
            "导出格式全局统一：不再为每个模块单独设置 HTML / MarkDown，统一在公共配置中选择一处即可（查看器内仍可按需切换展示方式并记忆）。",
            "媒体处理独立为开关：原「用 QQ空间外链（不下载）」是下载方式的一种取值，现独立为「媒体处理：下载到本地 / 使用QQ空间外链」。",
            "日志视图类开关移除：原「日志视图（列表/摘要）」「内容展示方式（表格/列表）」等展示类开关移除，改为在查看器内按需切换并记忆。日志默认按「摘要」展示，旧备份若没有摘要会自动回退为列表。",
            "打包方式下拉移除：备份产出方式由运行环境决定——支持 File System Access API 的浏览器（Chrome / Edge）直接写入本地目录；暂不支持的浏览器自动打包为 ZIP。",
            "说说「获取全文 / 展开全文」开关移除：全文采集已内置，不再作为单独开关。",
            "地图 Key 配置精简：移除百度、高德地图 Key，仅保留腾讯地图 Key（用于坐标转描述）。",
            "进度口径调整：去除「跳过」概念，跳过项统一按成功计入进度（仅影响进度展示口径，不影响实际备份内容）。",
        ],
    },
    {
        "title": "四、已废弃或移除的功能",
        "kind": "bullets",
        "items": [
            "淘汰旧版「助手内部 File 下载模式」：下载方式统一为「直写目录 / 浏览器下载 / Aria2 协议」三种。",
            "下线迅雷下载器：移除「迅雷（助手唤醒 / 剪切板唤醒 / 下载链接）」三种下载方式。迅雷版本更新频繁、协议兼容不稳定，维护成本高且用户使用率低；原有用户请改用浏览器下载器或 Aria2 协议下载器。",
            "下线旧模板系统，扩展包变小，加载更轻。",
            "移除旧采集代码，采集逻辑已全面重写。",
            "移除「请勿关闭或刷新页面」提示文案（功能已由后台保活替代，备份时可在别的标签页正常操作）。",
        ],
    },
    {
        "title": "五、升级注意事项（建议手动核对）",
        "kind": "numbered",
        "items": [
            "复核个人配置：部分设置项在新版中重新组织或被移除（见「三、配置与行为变更」）。旧版个别配置可能无法直接沿用——尤其是 Aria2 地址与端口、好友特殊分组、各模块增量备份开关、媒体处理方式等。建议升级前先截图记录你的自定义项，升级后在新设置页逐项确认一次。",
            "备份产物兼容：旧版导出的备份文件仍可打开；但看板、互动分析等新功能依赖新结构，建议用新版重新备份一次以获得完整体验。",
            "浏览器支持与备份产物：V3 目前仅支持 Chrome / Edge 等 Chromium 内核浏览器，备份直接写入你选择的本地目录；Firefox 等浏览器的支持将在后续阶段加入。",
            "首次使用引导：升级后在 QQ 空间内点击扩展图标会重新触发新手引导。",
            "历史卡顿自愈：若曾因长期使用累积数据导致浏览器卡顿，新版首次启动会自动清理，一般无需手动处理。",
        ],
    },
]


def char_unit(c):
    o = ord(c)
    if o > 0x2E80 or c in "，。、；：！？（）【】“”‘’…—·《》":
        return 1.0
    if c == " ":
        return 0.3
    return 0.55


def wrap(text, max_units):
    lines = []
    cur = ""
    cur_u = 0.0
    i = 0
    while i < len(text):
        c = text[i]
        u = char_unit(c)
        if cur_u + u > max_units and cur:
            # try to break at ascii word boundary
            if (c.isalnum() or c == "/") and cur and cur[-1].isalnum():
                sp = cur.rfind(" ")
                if sp > 0:
                    lines.append(cur[:sp])
                    cur = cur[sp + 1:]
                    cur_u = sum(char_unit(x) for x in cur)
                    continue
            lines.append(cur)
            cur = ""
            cur_u = 0.0
        cur += c
        cur_u += u
        i += 1
    if cur:
        lines.append(cur)
    return lines


def split_value(text):
    idx = text.find("价值：")
    if idx > 0:
        return text[:idx].rstrip("。；;") , text[idx:]
    return text, None


# ---- layout ----
parts = []
y = 0
LINE_BODY = 23
LINE_VALUE = 20
ITEM_GAP = 12
CARD_PAD = 22
SECTION_GAP = 30
TITLE_H = 30

# header
header_h = 150
parts.append(
    f'<rect x="0" y="0" width="{W}" height="{header_h}" fill="url(#hdr)"/>'
)
parts.append(
    f'<text x="{PAD}" y="62" font-family="{FONT}" font-size="34" font-weight="700" fill="#ffffff">QZoneExport 发版公告</text>'
)
parts.append(
    f'<text x="{PAD}" y="94" font-family="{FONT}" font-size="16" fill="#ede9fe">QQ空间导出助手 · V3 更新说明</text>'
)
parts.append(
    f'<rect x="{W-PAD-150}" y="46" width="150" height="34" rx="17" fill="#ffffff" opacity="0.18"/>'
)
parts.append(
    f'<text x="{W-PAD-75}" y="69" text-anchor="middle" font-family="{FONT}" font-size="16" font-weight="700" fill="#ffffff">3.0</text>'
)
y = header_h + SECTION_GAP

for sec in sections:
    # section title
    parts.append(
        f'<rect x="{PAD}" y="{y+4}" width="5" height="22" rx="2.5" fill="{ACCENT}"/>'
    )
    parts.append(
        f'<text x="{PAD+14}" y="{y+22}" font-family="{FONT}" font-size="20" font-weight="700" fill="{TITLE}">{sec["title"]}</text>'
    )
    y += TITLE_H + 12

    # compute items
    max_units = 47
    item_blocks = []
    for it in sec["items"]:
        main, val = split_value(it)
        ml = wrap(main, max_units)
        vl = wrap(val, 50) if val else []
        item_blocks.append((ml, vl))

    # card height
    total_h = CARD_PAD * 2
    for ml, vl in item_blocks:
        total_h += len(ml) * LINE_BODY + (len(vl) * LINE_VALUE if vl else 0) + ITEM_GAP
    total_h -= ITEM_GAP

    # card
    parts.append(
        f'<rect x="{PAD}" y="{y}" width="{USABLE}" height="{total_h}" rx="14" '
        f'fill="{CARD_BG}" stroke="{CARD_BORDER}" stroke-width="1" filter="url(#sh)"/>'
    )

    iy = y + CARD_PAD
    for idx, (ml, vl) in enumerate(item_blocks):
        if sec["kind"] == "numbered":
            marker = f"{idx+1}."
        else:
            marker = "•"
        # marker
        parts.append(
            f'<text x="{PAD+18}" y="{iy+15}" font-family="{FONT}" font-size="15" font-weight="700" fill="{ACCENT}">{marker}</text>'
        )
        tx = PAD + 38
        for ln in ml:
            parts.append(
                f'<text x="{tx}" y="{iy+15}" font-family="{FONT}" font-size="15" fill="{BODY}">{ln}</text>'
            )
            iy += LINE_BODY
        for ln in vl:
            parts.append(
                f'<text x="{tx}" y="{iy+13}" font-family="{FONT}" font-size="13" fill="{VALUE}">{ln}</text>'
            )
            iy += LINE_VALUE
        iy += ITEM_GAP

    y += total_h + SECTION_GAP

# footer
footer_h = 56
parts.append(
    f'<rect x="0" y="{y}" width="{W}" height="{footer_h}" fill="{HEADER_BOT}" opacity="0.08"/>'
)
parts.append(
    f'<text x="{PAD}" y="{y+34}" font-family="{FONT}" font-size="14" fill="{SUB}">QZoneExport · 数据由你掌控　|　生成日期 2026-08-10</text>'
)
y += footer_h

H = y

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}">
  <defs>
    <linearGradient id="hdr" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{HEADER_TOP}"/>
      <stop offset="1" stop-color="{HEADER_BOT}"/>
    </linearGradient>
    <filter id="sh" x="-5%" y="-3%" width="110%" height="106%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#1f2330" flood-opacity="0.10"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="{W}" height="{H}" fill="#f5f6fa"/>
  {chr(10).join(parts)}
</svg>'''

out = r"E:\Projects\Licfe\GitHub\QZoneExport\docs\release-notes-v3-poster.svg"
with open(out, "w", encoding="utf-8") as f:
    f.write(svg)

# validate
ET.fromstring(svg)
print("OK", H, "->", out)
