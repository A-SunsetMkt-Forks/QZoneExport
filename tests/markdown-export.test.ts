import { describe, it, expect, beforeEach } from 'vitest';
import { exportModuleMarkdown, resetMarkdownRootIndex } from '../core/export/markdown/index';
import type { FileWriter } from '../core/fs/writer';

function makeWriter() {
    const files = new Map<string, string>();
    const folders = new Set<string>();
    const writer: FileWriter = {
        createFolder: async (dir: string) => { folders.add(dir); },
        writeText: async (text: string, path: string) => { files.set(path, text); },
    } as unknown as FileWriter;
    return { writer, files, folders };
}

// 外链模式（在线表情地址）；另有 isQzoneUrl:false 的用例验证下载模式引用本地路径
const opts = { hasUserLink: true, isQzoneUrl: true };

describe('MarkDown 导出结构', () => {
    beforeEach(() => resetMarkdownRootIndex());

    it('列表模块按年归档 + 合并 index.md', async () => {
        const { writer, files } = makeWriter();
        const items = [
            { custom_create_time: '2021-03-04 10:00', content: 'a', custom_comments: [] },
            { custom_create_time: '2021-08-09 10:00', content: 'b', custom_comments: [{ name: 'x', content: 'hi' }] },
            { custom_create_time: '2022-01-01 10:00', content: 'c', custom_comments: [] },
        ];
        await exportModuleMarkdown('Messages', items, writer, opts);
        expect(files.has('Messages/2021.md')).toBe(true);
        expect(files.has('Messages/2022.md')).toBe(true);
        expect(files.has('Messages/index.md')).toBe(true);
        expect(files.get('Messages/2021.md')!.includes('## 03月')).toBe(true);
    });

    it('留言板按时间倒序（最新在上）：年份/月份倒序、组内保持采集器降序', async () => {
        const { writer, files } = makeWriter();
        // 传入顺序即采集器降序（最新在前），但跨年/跨月混合
        const items = [
            { pubtime: '2022-06-01 10:00', htmlContent: '六月', replyList: [] },
            { pubtime: '2021-12-31 10:00', htmlContent: '除夕', replyList: [] },
            { pubtime: '2021-03-04 10:00', htmlContent: '三月', replyList: [] },
            { pubtime: '2020-01-01 10:00', htmlContent: '元旦', replyList: [] },
        ];
        await exportModuleMarkdown('Boards', items, writer, opts);
        const md = files.get('Boards/index.md')!;
        // 年份倒序：2022 在 2021 前
        expect(md.indexOf('## 2022年')).toBeLessThan(md.indexOf('## 2021年'));
        expect(md.indexOf('## 2021年')).toBeLessThan(md.indexOf('## 2020年'));
        // 内容顺序对应最新在前
        expect(md.indexOf('六月')).toBeLessThan(md.indexOf('除夕'));
        expect(md.indexOf('除夕')).toBeLessThan(md.indexOf('三月'));
        // 年内月份倒序（在单独的年文件里）：2021 年 12 月在前、03 月在后
        const y2021 = files.get('Boards/2021.md')!;
        expect(y2021.indexOf('## 12月')).toBeLessThan(y2021.indexOf('## 03月'));
    });

    it('留言板/访客拆包 .items', async () => {
        const { writer, files } = makeWriter();
        const boardInfo = { items: [{ pubtime: '2020-05-05 10:00', content: '楼主', custom_comments: [] }] };
        await exportModuleMarkdown('Boards', boardInfo, writer, opts);
        expect(files.has('Boards/2020.md')).toBe(true);
        expect(files.get('Boards/2020.md')!.includes('楼主')).toBe(true);
    });

    it('留言板：标题带留言人、回复用「回复」标题、bmp 不渲染', async () => {
        const { writer, files } = makeWriter();
        const items = [{
            uin: 1510176045,
            nickname: '尘世间一个迷途小书童',
            pubtime: '2019-01-02 03:04',
            htmlContent: '踩踩',
            bmp: '585495800902e281', // bmp 是图片 ID 非 URL，不应渲染成图片
            replyList: [
                { uin: 1053703509, nick: '配角ゝ', time: 1545786971, content: '回踩' },
            ],
        }];
        await exportModuleMarkdown('Boards', items, writer, opts);
        const md = files.get('Boards/2019.md')!;
        // 标题行带留言人（带空间链接）
        expect(md).toContain('### 2019-01-02 03:04 · [尘世间一个迷途小书童](https://user.qzone.qq.com/1510176045)');
        // 回复块用「回复」标题，回复人带链接
        expect(md).toContain('**回复（1）**');
        expect(md).toContain('- [配角ゝ](https://user.qzone.qq.com/1053703509)（2018-12-26 09:16）：回踩');
        // bmp 是 ID 不渲染成图片
        expect(md).not.toContain('585495800902e281');
        expect(md).not.toContain('![');
    });

    it('日志/日记每篇独立 MD（按分类）', async () => {
        const { writer, files } = makeWriter();
        const items = [
            { title: '第一篇', pubtime: '2021-02-03 10:00', category: '生活', custom_html: '<p>正文</p>', custom_comments: [] },
            { title: '第二篇', pubtime: '2021-09-09 10:00', category: '工作', custom_html: '<p>内容</p>', custom_comments: [] },
        ];
        await exportModuleMarkdown('Blogs', items, writer, opts);
        const paths = Array.from(files.keys());
        expect(paths.some((p) => p.startsWith('Blogs/生活/') && p.endsWith('.md'))).toBe(true);
        expect(paths.some((p) => p.startsWith('Blogs/工作/') && p.endsWith('.md'))).toBe(true);
        expect(files.get(paths.find((p) => p.includes('第一篇'))!)!.includes('# 第一篇')).toBe(true);
        // 模块级入口 index.md（供根 index.md 链接，避免断链）
        expect(files.has('Blogs/index.md')).toBe(true);
        expect(files.get('Blogs/index.md')!.includes('[第一篇]')).toBe(true);
    });

    it('相册：每相册文件夹 + 按年 + 汇总 + 模块级 Albums/index.md + 根 index.md', async () => {
        const { writer, files } = makeWriter();
        const albums = [{
            name: '旅行',
            photoList: [
                { name: 'p1', url: 'u1', uploadTime: '2022-06-06 10:00', custom_comments: [] },
                { name: 'p2', url: 'u2', uploadTime: '2023-07-07 10:00', custom_comments: [] },
            ],
        }];
        await exportModuleMarkdown('Photos', albums, writer, opts);
        // 相册目录统一为 Albums（对齐 JSON/查看器），不再用旧 Photos
        expect(files.has('Albums/未分类/旅行/2022.md')).toBe(true);
        expect(files.has('Albums/未分类/旅行/2023.md')).toBe(true);
        expect(files.has('Albums/未分类/旅行/index.md')).toBe(true);
        expect(files.has('Albums/index.md')).toBe(true);
        expect(files.get('Albums/index.md')!.includes('[旅行]')).toBe(true);
        // 根 index.md 聚合
        expect(files.has('index.md')).toBe(true);
        expect(files.get('index.md')!.includes('[相册](Albums/index.md)')).toBe(true);
    });

    it('相册：按相册分类（className）嵌套归档，汇总按分类分组', async () => {
        const { writer, files } = makeWriter();
        const albums = [
            { name: 'A', className: '岁月', classSort: 1, photoList: [{ name: 'a', uploadTime: '2022-01-01 10:00', custom_comments: [] }] },
            { name: 'B', className: '其他', classSort: 7, photoList: [{ name: 'b', uploadTime: '2021-01-01 10:00', custom_comments: [] }] },
            { name: 'C', className: '岁月', classSort: 2, photoList: [{ name: 'c', uploadTime: '2020-01-01 10:00', custom_comments: [] }] },
        ];
        await exportModuleMarkdown('Photos', albums, writer, { ...opts, isQzoneUrl: false });
        expect(files.has('Albums/岁月/A/2022.md')).toBe(true);
        expect(files.has('Albums/岁月/C/2020.md')).toBe(true);
        expect(files.has('Albums/其他/B/2021.md')).toBe(true);
        // 分类汇总：分类标题 + 相册链接指向分类目录
        const idx = files.get('Albums/index.md')!;
        expect(idx).toContain('## 岁月（2）');
        expect(idx).toContain('## 其他（1）');
        expect(idx).toContain('- [A](./岁月/A/index.md)（1 张）');
    });

    it('相册：原图转载相片 uploadTime 为 1970 占位时，按真实拍摄时间 shootTime 归档', async () => {
        const { writer, files } = makeWriter();
        const albums = [{
            name: '原图转载相册测试',
            photoList: [
                // 真实数据：shootTime=1512782892 → 2017-12-09；uploadTime 是 QQ 的 1970 占位符
                { name: 'p1', url: 'u1', shootTime: 1512782892, uploadTime: '1970-01-01 07:59:59', custom_comments: [] },
                { name: 'p2', url: 'u2', shootTime: 1512786394, uploadTime: '1970-01-01 07:59:59', custom_comments: [] },
            ],
        }];
        await exportModuleMarkdown('Photos', albums, writer, opts);
        expect(files.has('Albums/未分类/原图转载相册测试/2017.md')).toBe(true);
        expect(files.has('Albums/未分类/原图转载相册测试/1970.md')).toBe(false);
    });

    it('相册：shootTime=0（Unix 纪元占位）时跳过，改用有效 uploadTime，不误归 1970', async () => {
        const { writer, files } = makeWriter();
        const albums = [{
            name: 'shootTime0测试',
            photoList: [
                { name: '000', url: 'u1', shootTime: 0, uploadTime: '2020-02-26 12:49:17', custom_comments: [] },
                { name: '正常', url: 'u2', shootTime: 1561452402, uploadTime: '2020-06-01 00:36:27', custom_comments: [] },
            ],
        }];
        await exportModuleMarkdown('Photos', albums, writer, opts);
        expect(files.has('Albums/未分类/shootTime0测试/2020.md')).toBe(true);
        expect(files.has('Albums/未分类/shootTime0测试/1970.md')).toBe(false);
    });

    it('好友：QQ好友.md', async () => {
        const { writer, files } = makeWriter();
        const friends = [
            { uin: '123', name: '张三', groupName: '同学' },
            { uin: '456', name: '李四', groupName: '家人' },
        ];
        await exportModuleMarkdown('Friends', friends, writer, opts);
        expect(files.has('Friends/QQ好友.md')).toBe(true);
        expect(files.get('Friends/QQ好友.md')!.includes('张三')).toBe(true);
    });

    it('收藏：按年 + 合并', async () => {
        const { writer, files } = makeWriter();
        const favorites = [
            { title: 'a', create_time: '2021-01-01 10:00', custom_abstract: '摘要a', custom_comments: [] },
            { title: 'b', create_time: '2021-12-31 10:00', custom_abstract: '摘要b', custom_comments: [] },
        ];
        await exportModuleMarkdown('Favorites', favorites, writer, opts);
        expect(files.has('Favorites/2021.md')).toBe(true);
        expect(files.has('Favorites/index.md')).toBe(true);
    });

    it('收藏：类型显示中文标签、标题/正文/媒体分段落、正文 HTML 转 Markdown', async () => {
        const { writer, files } = makeWriter();
        const favorites = [{
            type: 7, create_time: '2021-01-01 10:00',
            title: '无题', custom_abstract: '人生如<strong>戏</strong> <a href="https://user.qzone.qq.com/1">超链接</a>',
            custom_images: [{ url: 'http://img/1.jpg' }], custom_comments: [],
        }];
        await exportModuleMarkdown('Favorites', favorites, writer, opts);
        const md = files.get('Favorites/2021.md')!;
        // 类型标签为中文而非数字
        expect(md).toContain('**[分享]**');
        expect(md).not.toContain('**【7】**');
        // 标题（带原内容链接）独立成行
        expect(md).toContain('**《无题》**');
        // 正文 <strong>（戏）与 <a> 超链接均已转换
        expect(md).toContain('人生如戏');
        expect(md).toContain('[超链接](https://user.qzone.qq.com/1)');
        // 媒体图片
        expect(md).toContain('![图片](http://img/1.jpg)');
    });

    it('说说：表情/@ 全路径统一转换——正文、评论、评论回复、昵称', async () => {
        const { writer, files } = makeWriter();
        const items = [{
            custom_create_time: '2021-03-04 10:00',
            content: '情怀[em]e100[/em]@\u007buin:123,nick:芷炫,who:1\u007d结束',
            custom_comments: [{
                name: '[em]e101[/em]评论者', content: '评论[em]e102[/em]',
                replies: [{ name: '*小*,回复', content: '回复[em]e103[/em]' }],
            }],
        }];
        await exportModuleMarkdown('Messages', items, writer, opts);
        const md = files.get('Messages/index.md')!;
        // 正文 token
        expect(md).toContain('![e100](https://qzonestyle.gtimg.cn/qzone/em/e100.gif)');
        expect(md).toContain('@芷炫');
        expect(md).not.toContain('@{');
        // 昵称里的表情也转图（作者名不加粗，纯文本展示）
        expect(md).toContain('![e101](https://qzonestyle.gtimg.cn/qzone/em/e101.gif)评论者');
        expect(md).not.toContain('**![e101]');
        // 评论内容 + 评论回复内容
        expect(md).toContain('评论![e102](https://qzonestyle.gtimg.cn/qzone/em/e102.gif)');
        expect(md).toContain('回复![e103](https://qzonestyle.gtimg.cn/qzone/em/e103.gif)');
        // 嵌套回复昵称含 * 已转义，不产生 ***
        expect(md).not.toContain('***小*,回复');
    });

    it('留言：表情统一转换（留言正文/回复/昵称）', async () => {
        const { writer, files } = makeWriter();
        const items = [{
            pubtime: '2021-03-04 10:00',
            nickname: '留言者[em]e200[/em]',
            htmlContent: '正文[em]e201[/em]',
            replyList: [{ name: '回复者', content: '回复[em]e202[/em]' }],
        }];
        await exportModuleMarkdown('Boards', items, writer, opts);
        const md = files.get('Boards/index.md')!;
        expect(md).toContain('留言者![e200](https://qzonestyle.gtimg.cn/qzone/em/e200.gif)');
        expect(md).toContain('正文![e201](https://qzonestyle.gtimg.cn/qzone/em/e201.gif)');
        expect(md).toContain('回复![e202](https://qzonestyle.gtimg.cn/qzone/em/e202.gif)');
    });

    it('表情地址随媒体处理方式：下载模式（isQzoneUrl=false）引本地文件，外链模式引在线地址', async () => {
        const { writer, files } = makeWriter();
        const items = [{ custom_create_time: '2021-03-04 10:00', content: '表情[em]e50[/em]', custom_comments: [] }];
        // 下载模式：引用本地 Common/images/e50.gif（Messages 目录下 → 需上升到根再进入）与查看器一致
        await exportModuleMarkdown('Messages', items, writer, { ...opts, isQzoneUrl: false });
        expect(files.get('Messages/index.md')!).toContain('![e50](../Common/images/e50.gif)');
        // 外链模式：引用在线地址
        await exportModuleMarkdown('Messages', items, writer, { ...opts, isQzoneUrl: true });
        expect(files.get('Messages/index.md')!).toContain('![e50](https://qzonestyle.gtimg.cn/qzone/em/e50.gif)');
    });

    it('收藏：标题含表情时统一转换', async () => {
        const { writer, files } = makeWriter();
        const favorites = [{
            type: 3, create_time: '2021-01-01 10:00',
            title: '标题[em]e300[/em]', abstract: '摘要', custom_comments: [],
        }];
        await exportModuleMarkdown('Favorites', favorites, writer, opts);
        const md = files.get('Favorites/2021.md')!;
        expect(md).toContain('**《标题![e300](https://qzonestyle.gtimg.cn/qzone/em/e300.gif)》**');
    });

    it('评论/留言：昵称含 * 时不破坏强调渲染（不产生 ***某某***）', async () => {
        const { writer, files } = makeWriter();
        const items = [{
            custom_create_time: '2021-03-04 10:00',
            content: '正文', custom_comments: [{ name: '*芷炫', content: '你好' }],
        }];
        await exportModuleMarkdown('Messages', items, writer, opts);
        const md = files.get('Messages/index.md')!;
        // 昵称已转义（作者名不加粗），不会破坏强调，也不产生三连星号
        expect(md).not.toContain('***芷炫***');
        expect(md).not.toContain('**\\*芷炫**');
        expect(md).toContain('- \\*芷炫：你好');
    });

    it('留言板：图片写在 htmlContent 里时按 <img> 渲染，而非 BBcode [img]', async () => {
        const { writer, files } = makeWriter();
        const items = [{
            pubtime: '2021-03-04 10:00',
            htmlContent: '<a href="http://qzonestyle.gtimg.cn/qzone/em/063.gif"><img src="http://qzonestyle.gtimg.cn/qzone/em/063.gif"></a>测试',
            replyList: [],
        }];
        await exportModuleMarkdown('Boards', items, writer, opts);
        const md = files.get('Boards/index.md')!;
        expect(md).toContain('![](http://qzonestyle.gtimg.cn/qzone/em/063.gif)');
        expect(md).not.toContain('[img');
    });

    it('话题：# 后到下一个 # 或空白视为一个话题，包成带色 span 且不生成跳转链接', async () => {
        const { writer, files } = makeWriter();
        const items = [{
            custom_create_time: '2021-03-04 10:00',
            content: '想在#QQ空间 找下那年今日的心情，没找到。#高考 #我的高考记忆 #高考加油# 测试',
            custom_comments: [],
        }];
        await exportModuleMarkdown('Messages', items, writer, opts);
        const md = files.get('Messages/2021.md')!;
        expect(md).toContain('#QQ空间');
        expect(md).toContain('#高考');
        expect(md).toContain('#我的高考记忆');
        // 收尾的 #（后跟空格）不属于话题，保留为普通字符
        expect(md).toContain('#高考加油# 测试');
        // 不出现话题搜索跳转链接，且不再有原生 HTML
        expect(md).not.toContain('qzonesoso');
        expect(md).not.toContain('<span');
    });

    it('话题：已是 qzonesoso 跳转链接形态时只还原话题文本，不生成 MD 链接', async () => {
        const { writer, files } = makeWriter();
        const items = [{
            custom_create_time: '2021-03-04 10:00',
            content: '<a href="http://rc.qzone.qq.com/qzonesoso/?search=%E9%AB%98%E8%80%83" target="_blank" rel="noreferrer">#高考</a> 加油',
            custom_comments: [],
        }];
        await exportModuleMarkdown('Messages', items, writer, opts);
        const md = files.get('Messages/2021.md')!;
        expect(md).toContain('\\#高考 加油');
        expect(md).not.toContain('](http://rc.qzone.qq.com/qzonesoso/');
        expect(md).not.toContain('<span');
    });

    it('秒级时间戳 Number 正常归档，不落入 unknown（视频/分享/访客/日志）', async () => {
        const { writer, files } = makeWriter();
        const items = [
            { uploadTime: 1640395929, title: 't', url: 'http://v.mp4', comments: [] },   // 视频：秒级 Number
            { pubtime: 1640395929, ubbContent: 'hi', replyList: [] },               // 留言板：秒级 Number
            { shareTime: 1640395929, desc: '分享', source: { images: [] }, comments: [] }, // 分享
        ];
        await exportModuleMarkdown('Videos', items, writer, opts);
        await exportModuleMarkdown('Boards', items, writer, opts);
        await exportModuleMarkdown('Shares', items, writer, opts);
        expect(files.has('Videos/2021.md')).toBe(true);
        expect(files.has('Videos/unknown.md')).toBe(false);
        expect(files.has('Boards/2021.md')).toBe(true);
        expect(files.has('Shares/2021.md')).toBe(true);
        expect(files.get('Videos/2021.md')!.includes('[视频](http://v.mp4)')).toBe(true);
        expect(files.get('Boards/2021.md')!.includes('hi')).toBe(true);
        expect(files.get('Shares/2021.md')!.includes('分享')).toBe(true);
    });

    it('访客：用户带空间链接，且展示访问了哪些模块', async () => {
        const { writer, files } = makeWriter();
        // 访客数据是 { items: [...] } 结构，入口会拆包；name 有 "吕顺才"、uin 带空间地址
        const items = {
            items: [
                { uin: 1053703509, name: '配角ゝ', time: 1649226000, shuoshuoes: [], blogs: [], photoes: [], shares: [] },
                { uin: 1129136924, name: '吕顺才', time: 1786467083, blogs: [{ id: '1', name: '日志' }], photoes: [{ name: '相册' }] },
            ],
        };
        await exportModuleMarkdown('Visitors', items, writer, opts);
        const md = files.get('Visitors/index.md')!;
        expect(md).toContain('[配角ゝ](https://user.qzone.qq.com/1053703509) 访问了空间');
        expect(md).toContain('[吕顺才](https://user.qzone.qq.com/1129136924) 查看日志、相册');
        // 不再是无链接的加粗文本
        expect(md).not.toContain('**配角ゝ**');
    });

    it('说说配图读取 custom_url（V2 formatMediaMarkdown 同源字段）', async () => {
        const { writer, files } = makeWriter();
        const items = [{
            custom_create_time: '2021-03-04 10:00',
            content: '有图',
            custom_comments: [],
            pic: [{ custom_url: 'https://pic.store.qq.com/a.jpg', url1: 'https://pic.store.qq.com/b.jpg' }],
        }];
        await exportModuleMarkdown('Messages', items, writer, opts);
        const md = files.get('Messages/2021.md')!;
        expect(md).toContain('![图片](https://pic.store.qq.com/a.jpg)');
    });

    it('相册视频：封面图 + 链接，无原生 <video> 标签', async () => {
        const { writer, files } = makeWriter();
        const albums = [{
            name: '剪辑',
            photoList: [{ name: 'clip', url: 'http://v.mp4', is_video: true, uploadTime: '2022-01-01 10:00', custom_comments: [] }],
        }];
        await exportModuleMarkdown('Photos', albums, writer, opts);
        const md = files.get('Albums/未分类/剪辑/index.md')!;
        expect(md).not.toContain('<video');
        // 封面可点击打开视频：封面图被包成指向视频文件的链接
        expect(md).toContain('[![clip](http://v.mp4)](http://v.mp4)');
        expect(md).toContain('[点击播放视频](http://v.mp4)');
    });

    it('视频模块：封面可点击打开视频文件', async () => {
        const { writer, files } = makeWriter();
        const items = [{
            title: '视频标题',
            pre: 'http://cover/1.jpg', url: 'http://v/1.mp4', comments: [],
            custom_url: 'http://v/1.mp4', custom_pre_filepath: 'Videos/images/1.jpg',
            custom_filepath: 'Videos/files/1.mp4', uploadTime: 1640395929,
        }];
        await exportModuleMarkdown('Videos', items, writer, opts);
        const md = files.get('Videos/2021.md')!;
        // 下载模式本地封面 + 本地视频文件 → [![封面](cover)](play)，相对 Videos/ 目录换算
        expect(md).toContain('[![图片](images/1.jpg)](files/1.mp4)');
        // 不再是无封面的纯文本 [视频](url) 链接
        expect(md).not.toContain('[视频](http://v/1.mp4)');
    });

    it('图片地址相对各 MD 文件目录换算（Messages 用 images/..，相册用 images/..，表情用 ../Common/..）', async () => {
        const { writer, files } = makeWriter();
        // 说说：配图本地路径 Messages/images/x.jpg，表情本地 Common/images/e9.gif
        const msgs = [{
            custom_create_time: '2021-03-04 10:00',
            content: '图[em]e9[/em]',
            pic: [{ custom_url: 'http://online/a.jpg', custom_filepath: 'Messages/images/a.jpg' }],
            custom_comments: [],
        }];
        await exportModuleMarkdown('Messages', msgs, writer, { ...opts, isQzoneUrl: false });
        const msgMd = files.get('Messages/2021.md')!;
        expect(msgMd).toContain('![图片](images/a.jpg)');
        expect(msgMd).toContain('![e9](../Common/images/e9.gif)');

        // 相册：相片在 Albums/相册/images/ 下 → 相册内 md 用 images/z.jpg
        const albums = [{
            name: '相册',
            photoList: [{ name: 'z', url: 'http://o/z.jpg', custom_filepath: 'Albums/相册/images/z.jpg', uploadTime: '2022-01-01 10:00', custom_comments: [] }],
        }];
        await exportModuleMarkdown('Photos', albums, writer, { ...opts, isQzoneUrl: false });
        expect(files.get('Albums/未分类/相册/2022.md')!).toContain('![z](../../相册/images/z.jpg)');

        // 日志：正文图在 Blogs/分类/ 下 → 用 ../images/..（若图在 Blogs/images/）
        const blogs = [{
            title: '图日志', category: '日记', custom_create_time: '2021-05-05 10:00',
            content: '', custom_html: '<img src="Blogs/images/b.jpg">', custom_comments: [],
        }];
        await exportModuleMarkdown('Blogs', blogs, writer, { ...opts, isQzoneUrl: false });
        expect(files.get('Blogs/日记/1_20210505100000_【图日志】.md')!).toContain('![](../images/b.jpg)');
    });

    it('嵌套评论用 2 空格缩进（非 Tab，避免被当成代码块）', async () => {
        const { writer, files } = makeWriter();
        const items = [{
            custom_create_time: '2021-03-04 10:00',
            content: 'a',
            custom_comments: [{ name: 'x', content: 'hi', replies: [{ name: 'y', content: 're' }] }],
        }];
        await exportModuleMarkdown('Messages', items, writer, opts);
        const md = files.get('Messages/2021.md')!;
        expect(md).toContain('\n  - y：re');
        expect(md).not.toContain('\n\t-');
    });

    it('评论/回复支持 poster 嵌套、回复带时间、list_3 字段', async () => {
        const { writer, files } = makeWriter();
        const items = [{
            custom_create_time: '2021-03-04 10:00',
            content: 'a',
            custom_comments: [{
                // poster 嵌套结构（与查看器 commentUser 同口径）
                poster: { uin: 123, name: '评论人甲' },
                content: '主评论',
                create_time: 1614841200, // 2021-03-04 15:00（GMT+8）
                list_3: [
                    { poster: { uin: 456, nick: '回复人乙' }, content: '一条回复', create_time: 1614844800 }, // 2021-03-04 16:00
                ],
            }],
        }];
        await exportModuleMarkdown('Messages', items, writer, opts);
        const md = files.get('Messages/2021.md')!;
        // 评论人取 poster.name，时间取 create_time（优先于 createTime）
        expect(md).toContain('- [评论人甲](https://user.qzone.qq.com/123)（2021-03-04 15:00）：主评论');
        // 回复人取 poster.nick，回复带时间（回复不加粗，与主评论做层级区分）
        expect(md).toContain('\n  - [回复人乙](https://user.qzone.qq.com/456)（2021-03-04 16:00）：一条回复');
    });

    it('好友分组用 H2（非 H6 跳级）', async () => {
        const { writer, files } = makeWriter();
        const friends = [{ uin: '123', name: '张三', groupName: '同学' }];
        await exportModuleMarkdown('Friends', friends, writer, opts);
        const md = files.get('Friends/QQ好友.md')!;
        expect(md).toContain('## 同学');
        expect(md).not.toContain('######');
    });

    it('根 index.md 含开篇说明与目录条数', async () => {
        const { writer, files } = makeWriter();
        await exportModuleMarkdown('Messages', [{ custom_create_time: '2021-03-04 10:00', content: 'a', custom_comments: [] }], writer, opts);
        const md = files.get('index.md')!;
        expect(md).toContain('**导出说明**');
        // 开篇不再汇总包含模块，条数直接放目录条目括号里
        expect(md).not.toContain('包含模块：');
        expect(md).toContain('- [说说](Messages/index.md)（1 条）');
        expect(md).toContain('## 目录');
    });

    it('根 index.md 开篇说明含空间主人与导出时间（透传 opts.meta）', async () => {
        const { writer, files } = makeWriter();
        const meta = {
            hasUserLink: true,
            nickname: '小明',
            spaceName: '小明的空间',
            desc: '欢迎来到我的空间\n第二行',
            uin: 123456,
            exportTime: new Date(2026, 7, 20, 16, 48, 0),
        };
        await exportModuleMarkdown('Messages', [{ custom_create_time: '2021-03-04 10:00', content: 'a', custom_comments: [] }], writer, meta);
        const md = files.get('index.md')!;
        // 空间主人/名/QQ 各占一行，避免长行换行难看
        expect(md).toContain('空间主人：小明');
        expect(md).toContain('空间名：小明的空间');
        expect(md).toContain('QQ：123456');
        // 不再合并到一行
        expect(md).not.toContain('空间主人：小明（空间名');
        expect(md).toContain('空间简介：欢迎来到我的空间 第二行');
        expect(md).toContain('导出时间：2026-08-20 16:48');
        // 开篇去掉「包含模块」汇总，条数放目录
        expect(md).not.toContain('包含模块：');
        expect(md).toContain('- [说说](Messages/index.md)（1 条）');
        // 底部说明改用中文工具名
        expect(md).toContain('由 QQ空间导出助手 生成');
        expect(md).not.toContain('QZoneExport');
    });

    it('根 index.md 未透传 meta 时省略空间主人与导出时间', async () => {
        const { writer, files } = makeWriter();
        await exportModuleMarkdown('Messages', [{ custom_create_time: '2021-03-04 10:00', content: 'a', custom_comments: [] }], writer, opts);
        const md = files.get('index.md')!;
        expect(md).not.toContain('空间主人');
        expect(md).not.toContain('导出时间');
    });

    it('根 index.md 透传 profile 时渲染「空间资料」小节并清洗签名 BBcode', async () => {
        const { writer, files } = makeWriter();
        const meta = {
            hasUserLink: true,
            nickname: '吕顺才',
            spaceName: '双手合十、『祈祷』十指紧扣ゝ',
            desc: '情怀那年、也只能是那些年',
            uin: 1129136924,
            exportTime: new Date(2026, 7, 20, 16, 48, 0),
            profile: {
                nickname: '吕顺才',
                spacename: '双手合十、『祈祷』十指紧扣ゝ',
                sex: 1,
                constellation: 5,
                bloodtype: 3,
                marriage: 1,
                birthday: '10-28',
                country: '中国',
                province: '广东',
                city: '东莞',
                hco: '中国',
                hp: '广东',
                hc: '茂名',
                company: '易立德',
                cco: '中国',
                cp: '广东',
                cc: '深圳',
                signature: '[url=http://1053703509.qzone.qq.com/][ft=#ff0000,,楷体_GB2312][I]十指、如何能紧扣？[/I][/ft][/url]',
                // 无效占位值，必须被跳过
                age: 124,
                birthyear: 1901,
                is_famous: false,
            } as Record<string, unknown>,
        };
        await exportModuleMarkdown('Messages', [{ custom_create_time: '2021-03-04 10:00', content: 'a', custom_comments: [] }], writer, meta);
        const md = files.get('index.md')!;
        const profileBlock = md.slice(md.indexOf('## 空间资料'));
        expect(profileBlock).toContain('## 空间资料');
        expect(profileBlock).toContain('- **性别**：男');
        expect(profileBlock).toContain('- **生日**：10-28');
        expect(profileBlock).toContain('- **星座**：双子座');
        expect(profileBlock).toContain('- **血型**：O 型');
        expect(profileBlock).toContain('- **婚姻**：单身');
        expect(profileBlock).toContain('- **所在地**：中国 广东 东莞');
        expect(profileBlock).toContain('- **家乡**：中国 广东 茂名');
        expect(profileBlock).toContain('- **公司**：易立德（中国 广东 深圳）');
        // 签名 BBcode 被清洗为纯文本
        expect(profileBlock).toContain('- **个性签名**：十指、如何能紧扣？');
        expect(profileBlock).not.toContain('[url=');
        expect(profileBlock).not.toContain('[ft=');
        // 无效占位值不出现
        expect(profileBlock).not.toContain('124');
        expect(profileBlock).not.toContain('1901');
    });

    it('根 index.md 未透传 profile 时省略「空间资料」小节', async () => {
        const { writer, files } = makeWriter();
        const meta = {
            hasUserLink: true,
            nickname: '小明',
            uin: 123456,
            exportTime: new Date(2026, 7, 20, 16, 48, 0),
        };
        await exportModuleMarkdown('Messages', [{ custom_create_time: '2021-03-04 10:00', content: 'a', custom_comments: [] }], writer, meta);
        const md = files.get('index.md')!;
        expect(md).not.toContain('空间资料');
    });

    it('「空间资料」company 未填原样显示、bloodtype 0 跳过', async () => {
        const { writer, files } = makeWriter();
        const meta = {
            hasUserLink: true,
            nickname: '配角ゝ',
            uin: 1053703509,
            exportTime: new Date(2026, 7, 20, 16, 48, 0),
            profile: {
                sex: 2,
                constellation: 2,
                bloodtype: 0, // 未填 → 跳过
                marriage: 1,
                birthday: '06-20',
                country: '中国',
                province: '广东',
                city: '茂名',
                company: '还没有', // QQ 未填公司的原文，按用户要求原样显示
                cb: '保密',
                signature: '传说对着流星可以许愿',
                career: '',
            } as Record<string, unknown>,
        };
        await exportModuleMarkdown('Messages', [{ custom_create_time: '2021-03-04 10:00', content: 'a', custom_comments: [] }], writer, meta);
        const md = files.get('index.md')!;
        const profileBlock = md.slice(md.indexOf('## 空间资料'));
        expect(profileBlock).toContain('- **性别**：女');
        expect(profileBlock).toContain('- **星座**：双鱼座');
        expect(profileBlock).toContain('- **婚姻**：单身');
        expect(profileBlock).toContain('- **所在地**：中国 广东 茂名');
        expect(profileBlock).toContain('- **个性签名**：传说对着流星可以许愿');
        // company:"还没有" 原样显示（QQ 个人档未填时的原话）
        expect(profileBlock).toContain('- **公司**：还没有');
        expect(profileBlock).not.toContain('血型'); // bloodtype:0 不渲染
    });

    it('血型 5 渲染为「其他」', async () => {
        const { writer, files } = makeWriter();
        const meta = {
            hasUserLink: true,
            nickname: '测试',
            profile: { bloodtype: 5 } as Record<string, unknown>,
        };
        await exportModuleMarkdown('Messages', [{ custom_create_time: '2021-03-04 10:00', content: 'a', custom_comments: [] }], writer, meta);
        const md = files.get('index.md')!;
        const profileBlock = md.slice(md.indexOf('## 空间资料'));
        expect(profileBlock).toContain('- **血型**：其他');
    });
});
