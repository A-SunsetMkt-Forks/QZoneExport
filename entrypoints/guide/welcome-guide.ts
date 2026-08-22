import '../../core/shared/polyfill';

/**
 * 欢迎页引导系统
 */
(function () {
    const STORAGE_KEY = 'qzone_welcome_guide_done';

    // 构建期 WXT 会求值该 entrypoint 模块，但此时没有真实 DOM，getElementById 返回 null；
    // 直接返回可避免空引用错误。真实页面中这些元素必定存在，可正常初始化。
    if (typeof document === 'undefined' || !document.getElementById('guideMask')) {
        return;
    }

    // 安全注入：仅允许白名单标签（strong / br）及其文本节点，杜绝 step.body 中混入的
    // 任何脚本/事件/on* 属性（即便未来 body 来源变为不可信，也不会造成 XSS）。
    const SAFE_HTML_TAGS: Record<string, boolean> = { STRONG: true, BR: true };
    function safeSetHtml(el: Element | null, html: string): void {
        if (!el) return;
        el.textContent = '';
        if (typeof html !== 'string' || !html) return;
        const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
        const src = doc.body.firstChild;
        if (!src) return;
        const walk = function (node: ChildNode): DocumentFragment {
            const frag = document.createDocumentFragment();
            node.childNodes.forEach(function (child) {
                if (child.nodeType === 3 /* TEXT_NODE */) {
                    frag.appendChild(document.createTextNode(child.nodeValue || ''));
                } else if (child.nodeType === 1 /* ELEMENT_NODE */ && SAFE_HTML_TAGS[(child as Element).tagName]) {
                    const clone = document.createElement((child as Element).tagName);
                    clone.appendChild(walk(child));
                    frag.appendChild(clone);
                }
                // 其它标签与所有属性一律丢弃
            });
            return frag;
        };
        el.appendChild(walk(src));
    }

    interface GuideStep {
        title: string;
        body: string;
        target: string | null;
    }

    const guideSteps: GuideStep[] = [
        {
            title: '👋 欢迎使用！',
            body: '本引导带你快速熟悉页面，约 <strong>30 秒</strong>即可完成。随时可点「跳过引导」。',
            target: null,
        },
        {
            title: '📋 三步完成备份',
            body: '流程：<strong>打开空间 → 自动弹出备份窗口 → 选择内容开始备份</strong>。左侧是步骤，右侧是核心概念。',
            target: '#guide-steps',
        },
        {
            title: '💡 文案与媒体',
            body: '<strong>文案</strong>（说说文字、日志、好友列表等）采集即得；<strong>媒体</strong>（照片、视频等文件）需额外下载。',
            target: '#guide-concepts',
        },
        {
            title: '🎯 选择备份范围',
            body: '支持<strong>全部数据</strong>（首次推荐）、<strong>上次之后</strong>（增量）、<strong>指定时间</strong>（按需）三种。',
            target: '#guide-scope',
        },
        {
            title: '📦 默认配置组合',
            body: '首次推荐<strong>默认配置组合</strong>：HTML 格式 + 全量备份 + 媒体「助手直写目录」（Firefox 默认「浏览器下载器」）。',
            target: '#guide-default',
        },
        {
            title: '🌐 浏览器差异',
            body: 'Chrome / Edge 与 Firefox 的<strong>保存位置</strong>和<strong>下载方式</strong>不同（Firefox 无「助手直写目录」，文案直写下载目录）。',
            target: '#guide-browsers',
        },
        {
            title: '💡 查看与提示',
            body: '底部提示介绍了备份后的<strong>查看方式</strong>与「浏览器下载器」的注意事项。',
            target: '#guide-tip',
        },
        {
            title: '🚀 开始使用',
            body: '准备好后点击下方<strong>「去 QQ 空间备份」</strong>即可开始，或进入<strong>设置</strong>进一步调整。',
            target: '#guide-actions',
        },
    ];

    let currentStep = 0;
    let highlightEl: Element | null = null;
    const indicator = document.getElementById('guideIndicator') as HTMLElement;
    const titleEl = document.getElementById('guideTitle') as HTMLElement;
    const bodyEl = document.getElementById('guideBody') as HTMLElement;
    const prevBtn = document.getElementById('guidePrev') as HTMLButtonElement;
    const nextBtn = document.getElementById('guideNext') as HTMLButtonElement;
    const skipBtn = document.getElementById('guideSkip') as HTMLButtonElement;
    const mask = document.getElementById('guideMask') as HTMLElement;

    function highlightTarget(selector: string | null): void {
        clearHighlight();
        if (!selector) return;
        const el = document.querySelector(selector);
        if (el) {
            el.classList.add('guide-highlight');
            highlightEl = el;
            try {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch (e) { /* ignore */ }
        }
    }

    function clearHighlight(): void {
        if (highlightEl) {
            highlightEl.classList.remove('guide-highlight');
            highlightEl = null;
        }
    }

    function renderStep(): void {
        const step = guideSteps[currentStep];
        if (!step) return;
        const isLast = currentStep >= guideSteps.length - 1;

        indicator.textContent = '第 ' + (currentStep + 1) + ' / ' + guideSteps.length + ' 步';
        titleEl.textContent = step.title;
        safeSetHtml(bodyEl, step.body);

        prevBtn.disabled = currentStep === 0;
        nextBtn.textContent = isLast ? '开始使用' : '下一步';

        highlightTarget(step.target);
    }

    function next(): void {
        if (currentStep >= guideSteps.length - 1) {
            finish();
        } else {
            currentStep++;
            renderStep();
        }
    }

    function prev(): void {
        if (currentStep > 0) {
            currentStep--;
            renderStep();
        }
    }

    function finish(): void {
        mask.classList.remove('active');
        clearHighlight();
        try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) { /* ignore */ }
    }

    nextBtn.addEventListener('click', next);
    prevBtn.addEventListener('click', prev);
    skipBtn.addEventListener('click', finish);

    // 键盘支持：Enter=下一步, Escape=跳过
    document.addEventListener('keydown', function (e: KeyboardEvent) {
        if (!mask.classList.contains('active')) return;
        if (e.key === 'Enter') { next(); }
        else if (e.key === 'Escape') { finish(); }
        else if (e.key === 'ArrowLeft') { prev(); }
    });

    /**
     * 打开引导：仅首次访问时自动展示
     */
    function startGuide(): void {
        try {
            if (localStorage.getItem(STORAGE_KEY)) return;
        } catch (e) { /* ignore */ }

        if (!mask) return;

        mask.classList.add('active');
        renderStep();

        if (getComputedStyle(mask).display === 'none') {
            mask.style.display = 'flex';
        }
    }

    /**
     * 打开配置页面
     */
    function openOptions(): void {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            let url: string;
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
                url = chrome.runtime.getURL('options.html');
            } else {
                url = 'options.html';
            }
            window.open(url, '_blank');
        }
    }

    const btnOptions = document.getElementById('btnOptions') as HTMLButtonElement;
    btnOptions.addEventListener('click', openOptions);

    // 页面加载后自动启动引导
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startGuide);
    } else {
        startGuide();
    }
})();
