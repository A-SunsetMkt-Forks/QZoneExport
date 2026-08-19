/* ===== 备份面板 Shadow DOM 样式 ===== */
/* 从 backup-panel.content.ts 抽取，便于独立维护 */

export const STYLES = `
/* Shadow 边界兜底：切断从宿主页 <html> 继承进来的可继承属性
   （color / font-size / font-family / line-height / letter-spacing 等），
   避免 QQ空间样式穿过 shadow 边界渗入面板。
   注 1：原写法为 ::host（双冒号，伪元素语法），是非法选择器，浏览器静默丢弃，规则从未生效。
   注 2：host 的 position / inset / z-index / display 走内联样式（api.ts createPanel），
         特异性高于 :host，不会被 all:initial 冲掉。 */
:host { all: initial; }
.backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,.45);
    display: flex; align-items: center; justify-content: center;
    /* all:initial 生效后继承值回落到 UA 默认（16px / 衬线 / 黑），
       故在唯一根容器上钉死确定性基线，彻底不依赖宿主页 */
    font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
    font-size: 13px; line-height: 1.5; color: #333;
}
.panel {
    width: 96vw; max-width: 1080px;
    height: 88vh; /* 确定高度：保证面板始终占满可用视口，避免子级绝对定位时塌缩 */
    display: flex; flex-direction: column;
    background: #fff; border-radius: 12px;
    /* 绿色顶条改用 ::before 伪元素，避免 border-top + border-radius 在圆角处透出黑色三角 */
    box-shadow: 0 12px 48px rgba(0,0,0,.25);
    overflow: hidden;
    position: relative;
}
.panel::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: #2080f0;
    border-radius: 12px 12px 0 0;
    pointer-events: none;
}
/* === Header === */
.panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 22px 12px; gap: 16px;
    border-bottom: 1px solid #f0f0f0;
    flex: 0 0 auto;
}
.panel-title { font-size: 16px; font-weight: 700; color: #222; display: flex; align-items: center; gap: 10px; }
.panel-title .dot { width: 8px; height: 8px; border-radius: 50%; background: #2080f0; }
.panel-stats { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; }
.stat-chip {
    padding: 4px 10px; border-radius: 12px; background: #f5f7fa; color: #334155;
    display: inline-flex; align-items: center; gap: 6px; font-weight: 500;
}
.stat-chip b { color: #0f172a; font-weight: 700; }
.stat-chip.ok { background: #e8f3ff; color: #1559b0; }
.stat-chip.ok b { color: #0c4a9e; }
.stat-chip.running { background: #e6f4ff; color: #0b63c7; }
.stat-chip.running b { color: #084690; }
.stat-chip.fail { background: #fff0f0; color: #c53030; }
.stat-chip.fail b { color: #9a2222; }
.stat-chip.pause { background: #fff7e6; color: #9a5a00; }
.stat-chip.pause b { color: #6b3f00; }
.stat-chip.pending { background: #f1f5f9; color: #475569; }
.stat-chip.pending b { color: #334155; }
.panel-close {
    width: 30px; height: 30px; border: none; border-radius: 50%;
    background: #f5f5f5; color: #666; font-size: 18px; cursor: pointer;
    line-height: 30px; text-align: center; flex: none;
}
.panel-close:hover { background: #eee; }
/* === Stage banner (顶部动态提示区) === */
.panel-status {
    padding: 10px 22px; font-size: 13px; color: #475569; line-height: 1.6;
    background: #fafbfc; border-bottom: 1px solid #f0f0f0;
    flex: 0 0 auto;
}
.panel-status b { color: #0f172a; }
/* === Notifications (聚合通知区，替代原 panel-error) === */
.notifications {
    margin: 6px 22px 0; display: flex; flex-direction: column; gap: 6px;
    flex: 0 0 auto;
}
.notice {
    padding: 7px 12px; border-radius: 6px; font-size: 12px; line-height: 1.6;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.notice-p0 { background: #fef0f0; border: 1px solid #fca5a5; color: #791f1f; }
.notice-p1 { background: #fff7e6; border: 1px solid #fcd34d; color: #633806; }
.notice-p2 { background: #f1f5f9; border: 1px solid #e2e8f0; color: #334155; }
.notice-text { flex: 1; min-width: 0; }
.notice-btn {
    padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer;
    border: 1px solid; background: transparent; flex: none;
    line-height: 1.5;
}
.notice-p0 .notice-btn { color: #991b1b; border-color: #fca5a5; }
.notice-p1 .notice-btn { color: #854f0b; border-color: #fcd34d; }
.notice-p2 .notice-btn { color: #475569; border-color: #cbd5e1; }
.notice-btn:hover { opacity: 0.8; }
.notice-close { font-size: 14px; padding: 0 4px !important; border: none !important; color: inherit; background: none; }

.panel-banner {
    margin: 10px 22px 0; padding: 10px 14px;
    border-radius: 8px; font-size: 13px; font-weight: 600;
    line-height: 1.7; display: none;
    flex: 0 0 auto;
}
.panel-banner.ok { display: block; background: #e8f3ff; border: 1px solid #2080f0; color: #1559b0; }
.panel-banner.warn { display: block; background: #fff7e6; border: 1px solid #f0a020; color: #8a5a00; }
/* === Tabs === */
.tabs {
    display: flex; gap: 2px; padding: 0 22px;
    border-bottom: 1px solid #f0f0f0;
    flex: 0 0 auto;
}
.tab {
    padding: 10px 14px; border: none; background: none;
    font-size: 13px; font-weight: 600; color: #64748b;
    cursor: pointer; border-bottom: 2px solid transparent;
    display: inline-flex; align-items: center; gap: 6px;
}
.tab:hover { color: #0f172a; }
.tab.active { color: #1559b0; border-bottom-color: #2080f0; }
.tab .count {
    font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 10px;
    background: #f1f5f9; color: #475569;
}
.tab.active .count { background: #e8f3ff; color: #1559b0; }
.tab .count.has-issues { background: #fee2e2; color: #b91c1c; }
.tab.active .count.has-issues { background: #fee2e2; color: #b91c1c; }

/* === Tab Panels === */
/* 布局方案：.panel 已定高 88vh（确定值）。.panels 以 flex:1 1 auto 填充剩余空间
   （因父级高度确定，flex 分配稳定），并 position:relative 作为绝对定位容器。
   各 .tab-panel 用 absolute; inset:0 填满 .panels（取到确定高度），内部自行滚动
   （.media-table-scroll / .log-list / .about-wrap），分页栏 flex:0 0 auto 钉在底部，
   不再被裁切。绝对定位规避了「flex 行容器交叉轴百分比高度解析不可靠」的陷阱，
   且因 .panels 始终有确定高度，不会导致面板塌缩。 */
.panels { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.tab-panel {
    position: absolute; left: 0; right: 0; top: 0; bottom: 0;
    display: none; flex-direction: column; min-width: 0; min-height: 0;
    padding: 14px 22px; gap: 12px; overflow: hidden;
}
.tab-panel.active { display: flex; }
/* 日志页签：确保工具栏固定、日志列表填满剩余空间并独立滚动 */
.tab-panel[data-panel="log"] { overflow: hidden; }
/* 作者页签：内容较多（赞赏码/链接/声明），在 .panels 内填满并让 .about-wrap 内部滚动 */
.tab-panel[data-panel="about"] { overflow: hidden; }
/* 概览页签：模块区不收缩，TOP3 消息增多时整体可滚动，全局进度保持可见 */
.tab-panel[data-panel="ov"] { overflow-y: auto; }

/* 概览页签：撑满面板高度；模块区 flex:1 占满剩余空间，消除下方空白并放松紧凑度 */
.tab-panel[data-panel="ov"] { overflow: hidden; }

/* === Overview === */
.ov-global {
    flex: none;
    background: linear-gradient(135deg, #f0f6ff 0%, #eff6ff 100%);
    border-radius: 10px; padding: 16px 18px; border: 1px solid #dbeafe;
}
.ov-global-head { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; margin-bottom: 10px; }
.ov-global-pct { font-size: 26px; font-weight: 800; color: #0f172a; }
.ov-global-sub { font-size: 12px; color: #475569; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.ov-global-sub .tag { display: inline-flex; align-items: center; gap: 4px; }
.ov-progress {
    width: 100%; height: 10px; border-radius: 5px; background: rgba(148, 163, 184, .18);
    overflow: hidden; position: relative;
}
.ov-progress-fill {
    position: absolute; left: 0; top: 0; bottom: 0;
    background: linear-gradient(90deg, #2080f0, #409eff);
    border-radius: 5px; transition: width .4s ease;
}
/* 失败段：紧接成功段之后铺开（left 由 JS 设为成功段百分比） */
.ov-progress-fail {
    position: absolute; left: 0; top: 0; bottom: 0; width: 0;
    background: repeating-linear-gradient(45deg, #ef4444, #ef4444 4px, #dc2626 4px, #dc2626 8px);
    border-radius: 5px; transition: width .4s ease, left .4s ease;
}
.ov-progress-legend {
    margin-top: 6px; font-size: 11px; color: #64748b;
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 15px;
}
.ov-progress-legend .lg-fail { color: #b91c1c; font-weight: 600; }
.ov-progress-legend .lg-ok { color: #1d6fd4; font-weight: 600; }
.ov-section-title { flex: none; font-size: 13px; font-weight: 700; color: #334155; display: flex; align-items: center; gap: 8px; }
.ov-section-title::before { content: ''; width: 3px; height: 14px; border-radius: 2px; background: #2080f0; }

.ov-section { display: flex; flex-direction: column; min-height: 0; }
/* 模块区不参与 flex 收缩：内容高度即容器高度。
   当 TOP3 卡片增多使总内容超出 Tab 时，由 .tab-panel[data-panel="ov"] 的 overflow-y:auto
   在 Tab 层面出滚动条，不会压模块区 */
.ov-section--modules { flex: 0 0 auto; }
/* TOP3 固定按内容占位，绝不参与收缩，任何情况下都必须可见 */
.ov-section--top3 { flex: 0 0 auto; }
.ov-modules {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: auto; gap: 6px 16px;
    /* auto 行高 = 内容高度（含进度条），不会因容器空间不足而塌成 0；
       空间不够时 overflow-y: auto 出滚动条 */
    overflow-y: auto;
    align-content: start;
}
.mod-progress {
    display: flex; flex-direction: column; justify-content: center; gap: 3px;
    padding: 5px 8px; border-bottom: 1px dashed #eef2f7;
}
.mod-progress:last-child { border-bottom: none; }
.mod-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.mod-head .name { color: #0f172a; font-weight: 600; }
.mod-head .pct { color: #64748b; font-weight: 500; }
.mod-progress .bar {
    position: relative;
    height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden;
}
.mod-progress .bar .fill {
    position: absolute; top: 0; left: 0; height: 100%;
    background: linear-gradient(90deg, #409eff, #2080f0);
    border-radius: 3px; transition: width .3s ease;
}
/* 失败段：与成功段（.fill）拼接，颜色红，定位在成功段右侧 */
.mod-progress .bar .fill-fail {
    position: absolute; top: 0; height: 100%;
    background: linear-gradient(90deg, #ef4444, #dc2626);
    border-radius: 3px; transition: width .3s ease, left .3s ease;
}
.mod-progress.done .bar .fill { background: linear-gradient(90deg, #1559b0, #0c4a9e); }
.mod-progress.active .bar .fill { background: linear-gradient(90deg, #38bdf8, #0284c7); }
/* 未开始模块：名称置灰、进度条为浅灰底无填充 */
.mod-progress.idle .mod-head .name { color: #94a3b8; font-weight: 400; }
.mod-progress.idle .mod-head .pct { color: #cbd5e1; }
.mod-progress.idle .bar { background: #f1f5f9; }
/* 未选择模块：本次未勾选，整体弱化（半透明 + 浅灰）以与「参与备份」模块区分 */
.mod-progress.unselected { opacity: 0.62; }
.mod-progress.unselected .mod-head .name { color: #94a3b8; font-weight: 400; font-style: italic; }
.mod-progress.unselected .mod-head .pct { color: #cbd5e1; }
.mod-progress.unselected .bar { background: #f1f5f9; }
/* 无权限模块：他人空间下私有模块（日记/好友/收藏），不可备份，琥珀色锁定提示 */
.mod-progress.noperm .mod-head .name { color: #b45309; font-weight: 400; }
.mod-progress.noperm .mod-head .pct { color: #cbd5e1; }
.mod-progress.noperm .bar { background: repeating-linear-gradient(45deg, #fef3c7, #fef3c7 5px, #fde9b8 5px, #fde9b8 10px); }

/* Top3 实时卡片 —— 三列等高网格（确定可用，卡片等高不跳动）。
   min-height 让「空态」与「满卡片」占位一致，避免任务进出时整块高度跳动。 */
.ov-top3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; min-height: 90px; }
.top3-empty {
    grid-column: 1 / -1; display: flex; align-items: center; justify-content: center;
    min-height: 90px; color: #94a3b8; font-size: 12px;
}
.top-card {
    background: #fff; border: 1px solid #eef2f7; border-radius: 8px; padding: 6px 8px;
    display: flex; gap: 8px; align-items: flex-start;
}
.top-thumb {
    width: 40px; height: 40px; border-radius: 6px; flex: none;
    background: #f8fafc; background-size: cover; background-position: center;
    border: 1px solid #eef2f7; display: flex; align-items: center; justify-content: center;
    font-size: 18px; color: #94a3b8; overflow: hidden;
}
.top-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.top-name { font-size: 12px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.top-owner { font-size: 11px; color: #64748b; line-height: 1.4; max-height: 2.8em; overflow: hidden; }
.top-meta { font-size: 11px; color: #475569; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.top-meta .st-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.top-speed { font-weight: 700; color: #0b63c7; }
.top-bar { height: 4px; background: #f1f5f9; border-radius: 2px; overflow: hidden; }
.top-bar .fill { height: 100%; background: linear-gradient(90deg, #409eff, #2080f0); transition: width .3s ease; }
/* 不确定进度（大小未知仍下载中）：动画只走 class，updateTopCard 仅切换 .is-indeterminate，
   不每帧重写 inline 动画，避免动画重启造成进度条闪烁 */
.top-bar.is-indeterminate .fill {
    width: 100%;
    animation: qz-indeterminate 1.2s ease-in-out infinite;
    background: linear-gradient(90deg, #2080f055, #2080f0, #2080f055);
    background-size: 200% 100%;
}
@keyframes qz-indeterminate { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* === Media tab === */
.media-toolbar {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    padding-bottom: 8px; border-bottom: 1px solid #f0f0f0;
    flex: 0 0 auto;  /* 工具栏高度不变，防被压缩导致重叠 */
}
.filter-group { display: inline-flex; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
.filter-group button {
    border: none; background: #fff; padding: 5px 12px; font-size: 12px;
    color: #475569; cursor: pointer; font-weight: 500;
}
.filter-group button:hover { background: #f8fafc; }
.filter-group button.active { background: #2080f0; color: #fff; }
.search-input {
    padding: 5px 10px; border: 1px solid #e2e8f0; border-radius: 6px;
    font-size: 12px; outline: none; min-width: 220px; max-width: 320px; color: #0f172a; background: #fff;
}
.search-input:focus { border-color: #2080f0; }
/* 工具栏所有按钮统一左对齐排列（不推到右侧） */
.batch-btns { display: flex; gap: 6px; }
.btn {
    padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;
    cursor: pointer; border: 1px solid transparent;
    display: inline-flex; align-items: center; gap: 5px;
}
.btn-primary { background: #2080f0; color: #fff; }
.btn-primary:hover { background: #1366d6; }
.btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }
.btn-default { background: #fff; color: #475569; border-color: #cbd5e1; }
.btn-default:hover { background: #f8fafc; border-color: #94a3b8; }
.btn-default:disabled { opacity: .5; cursor: not-allowed; }
.btn-danger { background: #fff; color: #c53030; border-color: #fecaca; }
.btn-danger:hover { background: #fff5f5; border-color: #fca5a5; }
.btn-warn { background: #fff; color: #9a5a00; border-color: #fde68a; }
.btn-warn:hover { background: #fffbeb; border-color: #fcd34d; }
.btn-lg { padding: 14px 22px; font-size: 15px; border-radius: 10px; }
/* 图标按钮：仅显示图标，悬浮文字以原生 title 提示（避免被滚动容器裁剪） */
.icon-btn {
    width: 30px; height: 30px; padding: 0; gap: 0; flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 14px; line-height: 1;
}
/* 工具栏批量按钮：自定义样式化悬浮气泡（工具栏不在滚动容器内，不会被裁剪）
   行操作列按钮仍在滚动容器内，保留原生 title（见 media.ts buildRowButtons） */
.batch-btns .icon-btn { position: relative; }
.batch-btns .icon-btn::after {
    content: attr(data-tip);
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%) translateY(-4px);
    background: #1e293b;
    color: #fff;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    padding: 5px 9px;
    border-radius: 6px;
    pointer-events: none;
    opacity: 0;
    transition: opacity .15s ease, transform .15s ease;
    z-index: 60;
    box-shadow: 0 6px 18px rgba(15, 23, 42, .22);
}
.batch-btns .icon-btn::before {
    content: '';
    position: absolute;
    top: calc(100% + 2px);
    left: 50%;
    transform: translateX(-50%) translateY(-4px);
    border: 5px solid transparent;
    border-bottom-color: #1e293b;
    opacity: 0;
    transition: opacity .15s ease, transform .15s ease;
    pointer-events: none;
    z-index: 60;
}
.batch-btns .icon-btn:hover::after,
.batch-btns .icon-btn:hover::before {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}

/* === 模块阶段徽标 === */
.mod-head .name { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mod-extra { color: #94a3b8; font-weight: 500; }
.stg { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 600; }
.stg-idle { background: #f1f5f9; color: #475569; }
.stg-unselected { background: #f8fafc; color: #94a3b8; border: 1px solid #e2e8f0; }
.stg-noperm { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
.stg-run { background: linear-gradient(90deg, #e0f2fe, #bae6fd); color: #075985; animation: stgRun 2.2s ease-in-out infinite; }
.stg-ok { background: #dbeafe; color: #0c4a9e; }
.stg-err { background: #fee2e2; color: #991b1b; }
@keyframes stgRun { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.25); } }

/* === 目录选择 CTA（概览里的大号引导卡片） === */
.dir-cta {
    flex: none;
    display: flex; gap: 14px; align-items: center;
    padding: 18px 20px; border-radius: 12px;
    background: linear-gradient(135deg, #fff7ed 0%, #fef3c7 45%, #ffedd5 100%);
    border: 2px solid #f59e0b;
    box-shadow: 0 8px 26px rgba(245, 158, 11, .18);
    animation: dirCtaPulse 2.2s ease-in-out infinite;
    position: relative;
}
@keyframes dirCtaPulse {
    0%, 100% { box-shadow: 0 8px 26px rgba(245, 158, 11, .18); border-color: #f59e0b; }
    50% { box-shadow: 0 10px 32px rgba(245, 158, 11, .32); border-color: #ea580c; }
}
.dir-cta-left { display: flex; align-items: flex-start; gap: 14px; flex: 1; min-width: 0; }
.dir-cta-ic {
    width: 54px; height: 54px; border-radius: 14px; flex: none;
    background: #fff; display: flex; align-items: center; justify-content: center;
    font-size: 30px; border: 2px solid #fb923c; box-shadow: 0 4px 12px rgba(249, 115, 22, .2);
    animation: dirCtaBounce 1.6s ease-in-out infinite;
}
@keyframes dirCtaBounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
.dir-cta-title { font-size: 18px; font-weight: 800; color: #9a3412; margin-bottom: 6px; }
.dir-cta-desc { font-size: 13px; color: #78350f; line-height: 1.7; }
.dir-cta-right { flex: none; }
.dir-cta .btn-lg {
    background: linear-gradient(90deg, #ea580c, #dc2626);
    border: none; box-shadow: 0 6px 14px rgba(220, 38, 38, .25);
}
.dir-cta .btn-lg:hover { background: linear-gradient(90deg, #c2410c, #b91c1c); }
.dir-cta::before {
    content: "第一步"; position: absolute; top: -12px; left: 16px;
    background: #dc2626; color: #fff;
    padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700;
    letter-spacing: 1px;
}

/* === 支持作者 Tab === */
.about-wrap { display: flex; flex-direction: column; gap: 16px; padding: 6px 2px; overflow-y: auto; flex: 1; min-height: 0; }
.about-hero {
    display: flex; gap: 16px; align-items: center;
    padding: 16px 18px; border-radius: 12px;
    background: linear-gradient(135deg, #ecfdf5 0%, #eff6ff 100%);
    border: 1px solid #bfdbfe;
}
.about-hero-logo {
    width: 60px; height: 60px; border-radius: 16px; flex: none;
    background: #fff; border: 2px solid #93c5fd;
    object-fit: contain; padding: 6px;
}
.about-hero-title { font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 4px; }
.about-hero-sub { font-size: 13px; color: #475569; line-height: 1.7; margin-bottom: 8px; }
.about-hero-meta { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: #334155; }
.about-hero-meta a { color: #0b63c7; text-decoration: none; font-weight: 600; }
.about-hero-meta a:hover { text-decoration: underline; }

.about-section-title { font-size: 14px; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 6px; }
.about-desc { font-size: 13px; color: #475569; line-height: 1.8; margin: 0 0 2px; }

.about-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 860px) { .about-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.qr-hover { position: relative; display: inline-flex; }
.about-qr-thumb {
    width: 220px; height: 220px; object-fit: contain; cursor: zoom-in;
    border-radius: 6px; background: #fff;
}
.about-qr-full {
    position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: auto; height: auto; max-width: 90vw; max-height: 90vh; object-fit: contain;
    border: 1px solid #e5e7eb; border-radius: 10px; background: #fff;
    box-shadow: 0 12px 32px rgba(15, 23, 42, .22);
    display: none; z-index: 99999; pointer-events: none;
}
.qr-hover:hover .about-qr-full { display: block; }

/* === 媒体 Tab：列表视图（表格） + 分页 === */
.media-list-wrap {
    flex: 1; display: flex; flex-direction: column; gap: 8px; min-height: 0;
    overflow: hidden;  /* 裁剪溢出，让内部表格 overflow:auto 提供滚动 */
}
/* 真正的滚动盒：<table> 自身 display:table，overflow 不建立滚动容器，
   放在 flex 里会一路撑高把分页栏顶出可视区（#4）。外套一层 block 容器后，
   纵向滚动（#4）与横向滚动（#5）都由它提供。 */
.media-table-scroll {
    /* flex:1 (basis 0%) 而非 basis:auto：basis:auto 会以表格全量内容高度为初始尺寸，
       媒体数量多时浏览器可能按此值先行布局再应用 overflow，导致 scroll 容器未正确约束、
       撑破 flex 链路把分页栏顶出可视区。改为 basis:0% 让容器仅占据 flex 分配的空间，
       与日志 .log-list 的 flex:1 模式一致，overflow 正确建立滚动上下文。 */
    flex: 1; min-height: 0; min-width: 0; overflow: auto;
    background: #fff; border: 1px solid #eef2f7; border-radius: 8px;
    scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent;
}
.media-table-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
.media-table-scroll::-webkit-scrollbar-track { background: transparent; }
.media-table-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 5px; border: 2px solid #fff; }
.media-table-scroll::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
.media-table {
    /* 表头固定，表体滚动：用 separate + sticky header 实现 */
    border-collapse: separate; border-spacing: 0;
    /* fixed 布局才能让列宽严格受控、长文件名/长路径按列宽截断而不是撑宽表格（#5） */
    table-layout: fixed;
    width: 100%; min-width: 900px;
    font-size: 12px;
}
.media-table thead th {
    position: sticky; top: 0; z-index: 2;
    background: #f8fafc; color: #334155; font-weight: 600;
    text-align: left; padding: 8px 10px;
    border-bottom: 1px solid #e2e8f0;
    white-space: nowrap; user-select: none;
}
.media-table thead th.col-chk { width: 36px; padding-left: 12px; padding-right: 6px; }
.media-table thead th.col-type { width: 56px; }
.media-table thead th.col-file { width: auto; min-width: 200px; }
.media-table thead th.col-state { width: 92px; }
.media-table thead th.col-module { width: 132px; }
.media-table thead th.col-progress { width: 200px; }
.media-table thead th.col-actions { width: 184px; }
.media-table tbody td {
    padding: 7px 10px; border-bottom: 1px solid #f1f5f9;
    vertical-align: middle; white-space: nowrap;
    color: #334155;
    overflow: hidden; text-overflow: ellipsis;
}
.media-table tbody tr:hover { background: #f0f6ff; }
.media-table tbody tr.selected { background: #dbeafe; }
.media-table tbody tr.selected:hover { background: #bfdbfe; }
.media-table tbody tr:last-child td { border-bottom: none; }
.media-table td.col-chk { padding-left: 12px; padding-right: 6px; overflow: visible; }
.media-table td.col-chk input { width: 15px; height: 15px; cursor: pointer; accent-color: #2080f0; }
.media-table td.col-module .mod-name {
    display: inline-block; max-width: 100%; vertical-align: middle;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: #2080f0; font-weight: 600;
}

/* 类型 / 预览列：缩略图 + 类型文本，整块可点击弹出预览 */
.media-table th.col-type, .media-table td.col-type { width: 90px; text-align: center; }
.media-type {
    display: inline-flex; flex-direction: column; align-items: center; gap: 3px;
    cursor: pointer; flex: none; width: 74px;
}
.media-type .mt-thumb {
    position: relative;
    width: 46px; height: 46px; border-radius: 6px;
    background: #f8fafc; background-size: cover; background-position: center;
    border: 1px solid #eef2f7;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 18px; color: #94a3b8; overflow: hidden;
}
.media-type .mt-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 6px; }
.media-type .mt-ico { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 18px; }
.mt-thumb.mt-failed .mt-img { display: none; }
.media-type .mt-play {
    position: absolute; right: 2px; bottom: 2px; width: 16px; height: 16px;
    border-radius: 50%; background: rgba(0,0,0,.55); color: #fff; font-size: 9px;
    display: flex; align-items: center; justify-content: center; line-height: 1;
}
.media-type .mt-label { font-size: 11px; color: #475569; line-height: 1.2; white-space: nowrap; }
.media-type:hover { opacity: .88; }
.f-name.m-preview { cursor: pointer; text-decoration: underline dotted; }
.f-name.m-preview:hover { color: #2080f0; }

/* 文件 / 路径列：文件名、相对路径、（失败时）报错原因三行，均单行截断 */
.cell-name {
    display: flex; flex-direction: column; gap: 2px; min-width: 0; max-width: 100%;
}
.cell-name .f-name {
    color: #0f172a; font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cell-name .f-path { color: #64748b; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 报错原因（原「所属内容」列已移除，报错并入此列，见 #1） */
.cell-name .f-err {
    color: #b91c1c; font-size: 11px; background: #fef2f2;
    padding: 1px 5px; border-radius: 3px; width: fit-content; max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 状态标签 */
.state-chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 6px; border-radius: 4px; font-size: 11px; font-weight: 500;
    background: #f1f5f9; color: #475569;
}
.state-chip .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; background: currentColor; }
.state-chip.ok { background: #dbeafe; color: #0c4a9e; }
.state-chip.running { background: #e0f2fe; color: #075985; }
.state-chip.fail { background: #fee2e2; color: #991b1b; }
.state-chip.pause { background: #fef3c7; color: #92400e; }
.state-chip.pending { background: #f1f5f9; color: #475569; }

/* 进度列（进度条 + 字节/速度/ETA） */
.cell-progress { min-width: 0; }
.cell-progress .bar {
    height: 6px; background: #f1f5f9; border-radius: 3px; overflow: hidden; margin-bottom: 3px;
}
.cell-progress .bar .fill {
    height: 100%; background: linear-gradient(90deg, #409eff, #2080f0); transition: width .3s ease;
    border-radius: 3px;
}
.cell-progress .meta {
    display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;
    font-size: 11px; color: #475569;
}
.cell-progress .meta .spd { color: #0b63c7; font-weight: 700; }
.cell-progress .meta .eta { color: #64748b; }

/* 操作列（行尾，含 复制/暂停/继续/重试/取消）
   横向滚动时钉在右侧始终可见（#5）；需要跟随行底色，否则滚动时会露出底下的内容 */
.media-table th.col-actions,
.media-table td.col-actions {
    position: sticky; right: 0;
    white-space: nowrap; overflow: visible;
    box-shadow: -8px 0 8px -8px rgba(15, 23, 42, .25);
}
.media-table thead th.col-actions { z-index: 4; background: #f8fafc; }
.media-table tbody td.col-actions { z-index: 1; background: #fff; }
.media-table tbody tr:hover td.col-actions { background: #f0f6ff; }
.media-table tbody tr.selected td.col-actions { background: #dbeafe; }
.media-table tbody tr.selected:hover td.col-actions { background: #bfdbfe; }
.media-table td.col-actions .btn { padding: 0; font-size: 13px; margin-right: 3px; }
.media-table td.col-actions .icon-btn { width: 26px; height: 26px; border-radius: 6px; }
.media-table td.col-actions .btn:last-child { margin-right: 0; }
.cell-actions .btn { padding: 4px 8px; font-size: 11px; margin-right: 3px; }
.cell-actions .btn:last-child { margin-right: 0; }

/* === 分页栏 === */
.media-pagination {
    flex: 0 0 auto;
    display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
    padding: 8px 4px 2px;
    border-top: 1px solid #f0f0f0;
}
.pagination-info { font-size: 12px; color: #475569; }
.pagination-info b { color: #0f172a; }
.pagination-right { display: flex; align-items: center; gap: 8px; }
.page-size-select {
    padding: 4px 6px; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 5px;
    background: #fff; color: #334155; cursor: pointer; outline: none;
}
.page-size-select:focus { border-color: #2080f0; }
.page-buttons { display: inline-flex; gap: 3px; }
.page-buttons button {
    min-width: 28px; height: 26px; padding: 0 8px;
    border: 1px solid #e2e8f0; background: #fff; color: #334155;
    border-radius: 4px; font-size: 12px; cursor: pointer;
}
.page-buttons button:hover:not(:disabled) { background: #f0f6ff; border-color: #bfdbfe; }
.page-buttons button.active { background: #2080f0; color: #fff; border-color: #2080f0; }
.page-buttons button:disabled { opacity: .4; cursor: not-allowed; }

.empty-hint { padding: 40px 0; text-align: center; color: #94a3b8; font-size: 13px; }

/* 旧卡片样式保留（类名不再使用，避免其他地方引用时报错） */
.media-grid { flex: 1; overflow-y: auto; padding: 2px; }
.media-card { background: #fff; border: 1px solid #eef2f7; border-radius: 8px; display: none; }

/* === Logs tab === */
.log-toolbar {
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    padding-bottom: 8px; border-bottom: 1px solid #f0f0f0;
    flex: 0 0 auto;
}
.log-group { display: inline-flex; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
.log-group button {
    border: none; background: #fff; padding: 5px 12px; font-size: 12px;
    color: #475569; cursor: pointer; font-weight: 500;
}
.log-group button:hover { background: #f8fafc; }
.log-group button.active { background: #334155; color: #fff; }
.log-list {
    flex: 1; min-height: 0; overflow-y: auto; font-size: 12px; line-height: 1.7;
    background: #0f172a; border-radius: 8px; padding: 10px 14px; font-family: Consolas, 'Courier New', monospace;
}
.log-row { display: flex; gap: 10px; align-items: flex-start; padding: 2px 0; border-bottom: 1px dashed rgba(148, 163, 184, .1); }
.log-row:last-child { border-bottom: none; }
.log-time { color: #64748b; flex: none; white-space: nowrap; font-size: 11px; }
.log-lev { flex: none; font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 4px; min-width: 46px; text-align: center; }
.log-lev.INFO { background: #1e293b; color: #93c5fd; }
.log-lev.WARN { background: #422006; color: #fbbf24; }
.log-lev.ERROR { background: #450a0a; color: #f87171; }
.log-msg { flex: 1; color: #e2e8f0; word-break: break-word; }

/* === Footer === */
.panel-footer {
    display: none; align-items: center; justify-content: space-between; gap: 10px;
    padding: 12px 22px; border-top: 1px solid #f0f0f0; flex-wrap: wrap;
}
.panel-footer.active { display: flex; }
.footer-left, .footer-right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

/* 确认对话框 */
.confirm-overlay { position: absolute; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; border-radius: 12px; z-index: 5; }
.confirm-box { text-align: center; padding: 24px 28px; max-width: 360px; background: #fff; border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,.25); }
.confirm-msg { font-size: 14px; color: #333; line-height: 1.8; margin: 0 0 16px; white-space: pre-line; }
.confirm-btns { display: flex; gap: 12px; justify-content: center; }

/* 媒体预览弹层 */
.media-preview-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.82); display: flex; align-items: center; justify-content: center; z-index: 60; }
.media-preview-box { position: relative; max-width: 92%; max-height: 92%; display: flex; align-items: center; justify-content: center; }
.media-preview-close { position: absolute; top: -14px; right: -14px; width: 32px; height: 32px; border-radius: 50%; border: none; background: #fff; color: #333; font-size: 20px; line-height: 1; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.35); z-index: 2; }
.media-preview-body { display: flex; align-items: center; justify-content: center; }
.media-preview-body img, .media-preview-body video { max-width: 100%; max-height: 82vh; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,.5); background: #000; }
`;
