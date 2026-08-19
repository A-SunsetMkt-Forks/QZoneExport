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
            body: '本引导将带你快速了解页面结构，大约 <strong>30 秒</strong>即可完成。你可以随时点击「跳过引导」关闭。',
            target: null,
        },
        {
            title: '📋 三步完成备份',
            body: '整个备份流程分为三步：<strong>打开空间 → 自动弹出备份窗口 → 选择内容开始备份</strong>。左侧是详细说明，右侧是核心概念解释。',
            target: '#guide-steps',
        },
        {
            title: '💡 什么是文案和媒体？',
            body: '<strong>文案</strong>指说说文字、日志、好友列表等文本数据，采集即得。<br><strong>媒体</strong>指照片、视频等文件，需额外下载。',
            target: '#guide-concepts',
        },
        {
            title: '🎯 选择备份范围',
            body: '支持三种备份范围：<strong>全部数据</strong>（首次推荐）、<strong>上次之后</strong>（增量备份）、<strong>指定时间</strong>（按需备份）。',
            target: '#guide-scope',
        },
        {
            title: '📦 默认配置组合',
            body: '首次使用推荐采用<strong>默认配置组合</strong>：HTML 格式 + 全量备份 + 助手直写目录。',
            target: '#guide-default',
        },
        {
            title: '⚙️ 调整配置',
            body: '如需更灵活的配置（如增量备份「上次之后」、改用 Aria2协议下载器 等），可点击下方的<strong>「打开配置页面」</strong>自定义。',
            target: '#guide-default',
        },
        {
            title: '🚀 开始使用',
            body: '准备好了吗？点击下方的<strong>「去 QQ 空间备份」</strong>按钮前往空间页面开始备份。<br>如有疑问，可随时点击<strong>「打开配置页面」</strong>调整设置。',
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
            let url = '';
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
