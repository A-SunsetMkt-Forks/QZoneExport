/**
 * 备份面板 HTML 模板
 *
 * 使用 ES 模板字面量生成 Shadow DOM 内层结构。
 * 模板中通过 Storybook 标记（注释）标注各 UI 区域的起点，
 * 方便后续调整 DOM 结构时快速定位。
 */

import { STYLES } from './styles';

export function buildPanelHtml(): string {
    return `
        <style>${STYLES}</style>
        <div class="backdrop">
            <div class="panel">
                <!-- Header -->
                <div class="panel-header">
                    <div class="panel-title"><span class="dot"></span>QQ空间导出助手<span style="font-size:12px;color:#64748b;font-weight:500;">· 备份进度</span></div>
                    <div class="panel-stats" id="stats">
                        <span class="stat-chip" title="总任务数">总<b id="s-total">0</b></span>
                        <span class="stat-chip ok" title="成功完成">成功<b id="s-ok">0</b></span>
                        <span class="stat-chip running" title="进行中">进行<b id="s-run">0</b></span>
                        <span class="stat-chip fail" title="失败中断">失败<b id="s-fail">0</b></span>
                        <span class="stat-chip pause" title="已暂停">暂停<b id="s-pause">0</b></span>
                        <span class="stat-chip pending" title="等待中">待开始<b id="s-wait">0</b></span>
                    </div>
                    <button class="panel-close" title="关闭">×</button>
                </div>

                <div class="panel-status"></div>
                <div class="notifications" id="notifications"></div>
                <div class="panel-banner"></div>

                <!-- Tabs -->
                <div class="tabs">
                    <button class="tab active" data-tab="ov">📊 进度概览 <span class="count" id="c-ov">0</span></button>
                    <button class="tab" data-tab="detail">📑 采集明细 <span class="count" id="c-detail">0</span></button>
                    <button class="tab" data-tab="media">🖼️ 媒体清单 <span class="count" id="c-media">0</span></button>
                    <button class="tab" data-tab="log">📋 备份日志 <span class="count" id="c-log">0</span></button>
                    <button class="tab" data-tab="about">💝 支持作者</button>
                </div>

                <!-- Panels -->
                <div class="panels">
                    <!-- OVERVIEW -->
                    <div class="tab-panel active" data-panel="ov">
                        <div class="dir-cta" id="dir-cta" style="display:none;">
                            <div class="dir-cta-left">
                                <div class="dir-cta-ic">📁</div>
                                <div>
                                    <div class="dir-cta-title">第一步：选择备份保存目录</div>
                                    <div class="dir-cta-desc">选择一个本地文件夹，用来保存这次导出的 QQ 空间内容。<br>
                                    <b style="color:#c2410c;">⚠️ 建议选择一个空文件夹</b>，图片、视频、日志、说说等都会直接写入里面。<br>
                                    选择完成后备份会自动开始，过程中请<b>不要关闭 / 刷新</b>此页面。</div>
                                </div>
                            </div>
                            <div class="dir-cta-right">
                                <button class="btn btn-primary btn-lg" id="dir-cta-btn">📁 选择备份保存目录</button>
                            </div>
                        </div>

                        <div class="ov-global">
                            <div class="ov-global-head">
                                <div class="ov-global-pct" id="ov-pct" title="备份总进度 = 各勾选模块「采集进度 + 媒体下载进度」的均值（不再只看媒体下载）。单模块媒体少也不会提前到 100%">0%</div>
                                <div class="ov-global-sub">
                                    <span class="tag" id="ov-bytes">0 B / 0 B</span>
                                    <span class="tag" id="ov-speed">⬇ 0 B/s</span>
                                    <span class="tag" id="ov-elapsed">⏱ 已用时 -</span>
                                    <span class="tag" id="ov-mods">🗂 0/0 模块</span>
                                </div>
                            </div>
                            <!-- 进度条口径（方案 A）：
                                 绿段 = 备份总进度中「已成功」的部分；
                                 红段 = 媒体下载失败占媒体总量的比例，从绿段右端扣出（绿+红≤100），
                                 既保留失败可见性（见 #8），又让绿段直观代表「真正成功的总进度」。 -->
                            <div class="ov-progress">
                                <div class="ov-progress-fill" id="ov-fill" style="width:0%"></div>
                                <div class="ov-progress-fail" id="ov-fill-fail" style="width:0%"></div>
                            </div>
                            <div class="ov-progress-legend" id="ov-progress-note"></div>
                        </div>

                        <div class="ov-section ov-section--modules">
                            <div class="ov-section-title" style="margin-bottom:8px;">模块采集</div>
                            <div class="ov-modules" id="ov-modules"></div>
                        </div>

                        <div class="ov-section ov-section--top3">
                            <!-- 仅改可见文案（原「正在下载（TOP6）」）：条数限制改用悬浮提示说明。
                                 渲染逻辑、容器 id（ov-top3）、取数条数一律保持不变 -->
                            <div class="ov-section-title" style="margin-bottom:8px;"><span class="ov-title-tip" title="当前列表仅显示前六条下载任务，更多任务请前往媒体页签查看">媒体下载</span></div>
                            <div class="ov-top3" id="ov-top3"></div>
                        </div>
                    </div>

                    <!-- MEDIA -->
                    <div class="tab-panel" data-panel="media">
                        <div class="media-toolbar">
                            <div class="filter-group" id="state-filter">
                                <button class="active" data-state="all">全部</button>
                                <button data-state="in_progress">进行中</button>
                                <button data-state="interrupted">失败</button>
                                <button data-state="paused">已暂停</button>
                                <button data-state="pending">待开始</button>
                                <button data-state="complete">成功</button>
                            </div>
                            <div class="filter-group" id="type-filter">
                                <button class="active" data-type="all">全部类型</button>
                                <button data-type="image">图片</button>
                                <button data-type="video">视频</button>
                            </div>
                            <select id="media-module-filter" class="page-size-select">
                                <option value="all">全部模块</option>
                            </select>
                            <select id="media-sort" class="page-size-select">
                                <option value="default">排序：注册顺序</option>
                                <option value="newest">排序：最新优先</option>
                                <option value="oldest">排序：最早优先</option>
                            </select>
                            <input class="search-input" id="media-search" placeholder="🔍 搜索文件名/路径/所属模块…" />
                            <div class="batch-btns">
                                <button class="btn btn-warn icon-btn" id="btn-pause" data-tip="暂停选中任务" aria-label="暂停选中任务">⏸</button>
                                <button class="btn btn-primary icon-btn" id="btn-resume" data-tip="继续选中任务" aria-label="继续选中任务">▶</button>
                                <button class="btn btn-default icon-btn" id="btn-retry" data-tip="重试失败任务" aria-label="重试失败任务">↻</button>
                                <button class="btn btn-danger icon-btn" id="btn-cancel" data-tip="取消选中任务" aria-label="取消选中任务">✕</button>
                            </div>
                        </div>
                        <div class="media-list-wrap">
                            <!-- 滚动容器必须是外层 block 元素：table 自身 overflow 不建立滚动盒，
                                 会撑破 flex 容器导致分页栏被顶出可视区、且没有纵向滚动条（#4） -->
                            <div class="media-table-scroll" id="media-table-scroll">
                            <table class="media-table" id="media-table">
                                <thead>
                                    <tr>
                                        <th class="col-chk"><input type="checkbox" id="media-chk-all" title="全选当前页" /></th>
                                        <th class="col-type">类型 / 预览</th>
                                        <th class="col-file">文件 / 路径</th>
                                        <th class="col-state">状态</th>
                                        <th class="col-module">所属模块</th>
                                        <th class="col-progress">进度 / 速度 / 剩余</th>
                                        <th class="col-actions">操作</th>
                                    </tr>
                                </thead>
                                <tbody id="media-tbody"></tbody>
                            </table>
                            </div>
                            <div class="media-pagination">
                                <div class="pagination-info" id="media-page-info">-</div>
                                <div class="pagination-right">
                                    <select class="page-size-select" id="media-page-size">
                                        <option value="20">每页 20 条</option>
                                        <option value="50" selected>每页 50 条</option>
                                        <option value="100">每页 100 条</option>
                                        <option value="200">每页 200 条</option>
                                        <option value="500">每页 500 条</option>
                                    </select>
                                    <div class="page-buttons" id="media-page-buttons"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- DETAIL / 采集明细 -->
                    <div class="tab-panel" data-panel="detail">
                        <div class="media-toolbar">
                            <div class="filter-group" id="detail-state-filter">
                                <button class="active" data-state="all">全部</button>
                                <button data-state="failed">失败</button>
                                <button data-state="dead">死页</button>
                                <button data-state="success">成功</button>
                            </div>
                            <select id="detail-module-filter" class="page-size-select">
                                <option value="all">全部模块</option>
                            </select>
                            <input class="search-input" id="detail-search" placeholder="🔍 搜索模块 / 错误信息…" />
                            <div class="batch-btns">
                                <button class="btn btn-warn" id="btn-retry-detail" title="重新采集之前失败或丢失的页（只补这些页，不影响已备份内容）" aria-label="重试失败页">↻ 重试失败页</button>
                            </div>
                        </div>
                        <div class="media-list-wrap">
                            <div class="media-table-scroll" id="detail-table-scroll">
                            <table class="media-table" id="detail-table">
                                <thead>
                                    <tr>
                                        <th>模块</th>
                                        <th>页码</th>
                                        <th>状态</th>
                                        <th>实采 / 期望</th>
                                        <th>重试</th>
                                        <th>采集时间</th>
                                        <th>错误信息</th>
                                    </tr>
                                </thead>
                                <tbody id="detail-tbody"></tbody>
                            </table>
                            </div>
                            <div class="media-pagination">
                                <div class="pagination-info" id="detail-page-info">-</div>
                                <div class="pagination-right">
                                    <select class="page-size-select" id="detail-page-size">
                                        <option value="20">每页 20 条</option>
                                        <option value="50" selected>每页 50 条</option>
                                        <option value="100">每页 100 条</option>
                                        <option value="200">每页 200 条</option>
                                    </select>
                                    <div class="page-buttons" id="detail-page-buttons"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- LOGS -->
                    <div class="tab-panel" data-panel="log">
                        <div class="log-toolbar">
                            <div class="log-group" id="lev-filter">
                                <button class="active" data-lev="ALL">全部</button>
                                <button data-lev="INFO">INFO</button>
                                <button data-lev="WARN">WARN</button>
                                <button data-lev="ERROR">ERROR</button>
                            </div>
                            <input class="search-input" id="log-search" placeholder="🔍 搜索日志内容…" />
                            <div class="log-export-group" style="display:flex;gap:5px;margin-left:auto;">
                                <button class="btn btn-default" id="btn-export-log-txt" title="导出为可直接查看的文本文件">📄 导出 TXT</button>
                                <button class="btn btn-default" id="btn-export-log-json" title="导出为结构化 JSON，便于调试分析">📋 导出 JSON</button>
                                <button class="btn btn-default" id="btn-clear-log">清空</button>
                            </div>
                        </div>
                        <div class="log-list" id="log-list"></div>
                    </div>

                    <!-- ABOUT / 支持作者 -->
                    <div class="tab-panel" data-panel="about">
                        <div class="about-wrap">
                            <div class="about-hero">
                                <img class="about-hero-logo" src="${chrome.runtime.getURL('img/icon.png')}" alt="QQ空间导出助手" />
                                <div>
                                    <div class="about-hero-title">QQ 空间导出助手</div>
                                    <div class="about-hero-sub">把 QQ 空间的说说 / 相册 / 日志 / 视频 / 留言 / 好友 / 收藏 / 分享 / 访客，一键导出为可离线浏览的本地备份包。</div>
                                <div class="about-hero-meta">
                                    <span>📦 开源：<a href="https://github.com/ShunCai/QZoneExport" target="_blank" rel="noreferrer">ShunCai/QZoneExport</a></span>
                                    <a href="https://github.com/ShunCai/QZoneExport" target="_blank" rel="noreferrer">⭐ 去 GitHub 点个 Star</a>
                                    <span>📜 开源协议 Apache-2.0</span>
                                </div>
                                </div>
                            </div>

                            <div class="about-section-title">📜 免责声明</div>
                            <p class="about-desc">本助手开源免费，不收集或贩卖个人信息。数据仅在本地浏览器处理，不向远程服务器传输。因使用本助手导致的封号等后果，概不负责。</p>

                            <div class="about-section-title">💝 赞赏 & 支持</div>
                            <p class="about-desc">如果你觉得这个工具帮到了你，不妨点个 Star、或者请作者喝一杯咖啡 / 奶茶。你的赞赏 = 后续功能迭代的动力，也是作者继续维护和追修复 Bug 的精神食粮。</p>

                            <div class="about-grid">
                                <div class="qr-hover"><img class="about-qr-thumb" src="${chrome.runtime.getURL('img/about/reward-alipay.png')}" alt="支付宝赞赏码"><img class="about-qr-full" src="${chrome.runtime.getURL('img/about/reward-alipay.png')}" alt="支付宝赞赏码"></div>
                                <div class="qr-hover"><img class="about-qr-thumb" src="${chrome.runtime.getURL('img/about/reward-wechat.png')}" alt="微信赞赏码"><img class="about-qr-full" src="${chrome.runtime.getURL('img/about/reward-wechat.png')}" alt="微信赞赏码"></div>
                                <div class="qr-hover"><img class="about-qr-thumb" src="${chrome.runtime.getURL('img/about/qq-group.png')}" alt="QQ 群二维码"><img class="about-qr-full" src="${chrome.runtime.getURL('img/about/qq-group.png')}" alt="QQ 群二维码"></div>
                            </div>

                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="panel-footer">
                    <div class="footer-left"></div>
                    <div class="footer-right">
                        <button class="btn btn-default btn-close">关闭</button>
                    </div>
                </div>

                <!-- 确认对话框（默认隐藏） -->
                <div class="confirm-overlay" style="display:none">
                    <div class="confirm-box">
                        <p class="confirm-msg"></p>
                        <div class="confirm-btns">
                            <button class="btn btn-primary confirm-ok">确定</button>
                            <button class="btn btn-default confirm-cancel">取消</button>
                        </div>
                    </div>
                </div>

                <!-- 媒体预览弹层（默认隐藏） -->
                <div class="media-preview-overlay" id="media-preview" style="display:none">
                    <div class="media-preview-box">
                        <button class="media-preview-close" id="media-preview-close" title="关闭预览">×</button>
                        <div class="media-preview-body" id="media-preview-body"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
}
