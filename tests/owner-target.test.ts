// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { computeOwnerTargetInteraction } from '../viewer/src/data/owner-target';

const OWNER = 10001; // 备份操作者（我）
const TARGET = 1334122472; // 空间主人（TA）

describe('我与TA的互动：纯计算逻辑', () => {
    it('Owner ≠ Target 时启用，并准确统计双向互动', () => {
        const messages: Record<string, any>[] = [
            {
                tid: 'msg-1',
                created_time: 1700000000,
                custom_comments: [
                    {
                        uin: OWNER,
                        name: '老王',
                        postTime: 1700000000,
                        replies: [{ uin: TARGET, name: '芷炫', postTime: 1700001000 }],
                    },
                ],
                likes: [{ fuin: OWNER, nickname: '老王', create_time: 1700000000 }],
            },
            { tid: 'msg-2', created_time: 1700005000, custom_comments: [] },
        ];
        const boards: Record<string, any>[] = [
            {
                id: 'board-1',
                uin: OWNER,
                name: '老王',
                pubtime: 1690000000,
                replyList: [{ uin: TARGET, name: '芷炫', time: 1690001000 }],
            },
        ];
        const blogs: Record<string, any>[] = [];

        const stat = computeOwnerTargetInteraction(OWNER, TARGET, messages, boards, blogs);

        expect(stat.enabled).toBe(true);
        expect(stat.ownerUin).toBe('10001');
        expect(stat.targetUin).toBe('1334122472');
        expect(stat.ownerName).toBe('老王');
        expect(stat.targetName).toBe('芷炫');

        // 四项动作维度
        expect(stat.myBoards).toBe(1);
        expect(stat.myComments).toBe(1);
        expect(stat.taReplies).toBe(2); // 评论回复 + 留言回复
        expect(stat.myLikes).toBe(1);
        expect(stat.totalInteractions).toBe(5);

        // 双向会话：msg-1（我评论且TA回复）、board-1（我留言且TA回复）
        expect(stat.conversations).toBe(2);

        // 方向计数
        expect(stat.fromMe).toBe(3); // 评论 + 点赞 + 留言
        expect(stat.fromTa).toBe(2); // 两条回复

        // 时间范围
        expect(stat.firstTime).toBe(1690000000);
        expect(stat.lastTime).toBe(1700001000);

        // 月度趋势（仅含事件月份，升序）
        expect(stat.monthly.map((m) => m.key)).toEqual(['2023-07', '2023-11']);
        expect(stat.monthly.map((m) => m.count)).toEqual([2, 3]);
    });

    it('TA 在自己留言板发帖、我回复：算作首次互动并计入时间（修复漏统计）', () => {
        // 镜像场景：留言板作者为 TA，我回复了 TA 的这条留言（此前完全漏统计）
        const boards: Record<string, any>[] = [
            {
                id: 'board-ta',
                uin: TARGET, // TA 是作者
                name: '芷炫',
                pubtime: 1680000000, // TA 发帖时间（线程起点）
                replyList: [{ uin: OWNER, name: '老王', time: 1680001000 }], // 我回复
            },
        ];
        const stat = computeOwnerTargetInteraction(OWNER, TARGET, [], boards, []);

        // 我回复 TA 的留言板 → 计为「我留言」
        expect(stat.myBoards).toBe(1);
        // 该线程我（回复）与 TA（发帖）双方参与 → 共同会话 1
        expect(stat.conversations).toBe(1);
        // 首次互动应为这条留言板线程的最早时间（TA 发帖在先），不再为空
        expect(stat.firstTime).toBe(1680000000);
        expect(stat.firstEntry?.type).toBe('board');
        expect(stat.lastTime).toBe(1680001000);
        // 方向计数：me（我回复）=1；TA 的发帖不是「TA 回应我」，不计入 fromTa
        expect(stat.fromMe).toBe(1);
        expect(stat.fromTa).toBe(0);
        expect(stat.taReplies).toBe(0);
        expect(stat.totalInteractions).toBe(1);
    });

    it('TA 单方面发布留言板（我未参与）不计入互动', () => {
        const boards: Record<string, any>[] = [
            {
                id: 'board-ta-alone',
                uin: TARGET,
                name: '芷炫',
                pubtime: 1680000000,
                replyList: [], // 我未回复
            },
        ];
        const stat = computeOwnerTargetInteraction(OWNER, TARGET, [], boards, []);
        expect(stat.myBoards).toBe(0);
        expect(stat.conversations).toBe(0);
        expect(stat.firstTime).toBeNull();
        expect(stat.totalInteractions).toBe(0);
    });

    it('仅我单向互动（TA未回复）不计入「共同会话」', () => {
        const messages: Record<string, any>[] = [
            {
                tid: 'msg-x',
                created_time: 1700000000,
                // 我评论了，但 TA 没有回复
                custom_comments: [{ uin: OWNER, name: '老王', postTime: 1700000000, replies: [] }],
                likes: [],
            },
        ];
        const stat = computeOwnerTargetInteraction(OWNER, TARGET, messages, [], []);
        expect(stat.myComments).toBe(1);
        expect(stat.taReplies).toBe(0);
        expect(stat.conversations).toBe(0); // 无 TA 回应 → 非双向会话
    });

    it('Owner === Target（查看自己空间）时禁用', () => {
        const stat = computeOwnerTargetInteraction(TARGET, TARGET, [], [], []);
        expect(stat.enabled).toBe(false);
    });

    it('ownerUin 缺失时禁用', () => {
        const stat = computeOwnerTargetInteraction(undefined as any, TARGET, [], [], []);
        expect(stat.enabled).toBe(false);
    });

    it('我点赞统计覆盖日志/相册/相片/分享/视频（而非仅说说）', () => {
        const messages: Record<string, any>[] = [
            { tid: 'm1', created_time: 1694000000, custom_comments: [], likes: [{ fuin: OWNER, nickname: '老王' }] },
        ];
        const blogs: Record<string, any>[] = [
            { id: 'b1', pubtime: 1695000000, custom_comments: [], likes: [{ fuin: OWNER, nickname: '老王' }] },
        ];
        const albums: Record<string, any>[] = [
            {
                name: '旅行相册',
                uploadtime: 1696000000,
                likes: [{ fuin: TARGET, nickname: '芷炫' }], // TA 点的，不计入「我」
                photoList: [
                    { name: '海边', uploadtime: 1696100000, likes: [{ fuin: OWNER, nickname: '老王' }] },
                    { name: '山顶', uploadtime: 1696200000, likes: [{ fuin: TARGET, nickname: '芷炫' }] },
                ],
            },
        ];
        const shares: Record<string, any>[] = [
            { shareTime: 1697000000, content: '分享好文', likes: [{ fuin: OWNER, nickname: '老王' }] },
        ];
        const videos: Record<string, any>[] = [
            { uploadtime: 1698000000, name: '录像', likes: [{ fuin: OWNER, nickname: '老王' }] },
        ];

        const stat = computeOwnerTargetInteraction(OWNER, TARGET, messages, [], blogs, albums, shares, videos);

        // 我点赞：说说1 + 日志1 + 相片1(海边) + 分享1 + 视频1 = 5（相册本身那条是 TA 点的，不计入）
        expect(stat.myLikes).toBe(5);
        expect(stat.totalInteractions).toBe(5);
        // 首/末互动时间覆盖新增模块的点赞事件（消息最早 1694000000，视频最晚 1698000000）
        expect(stat.firstTime).toBe(1694000000);
        expect(stat.lastTime).toBe(1698000000);
        expect(stat.firstEntry?.type).toBe('message');
        expect(stat.lastEntry?.type).toBe('video');
        // 月度趋势应聚合这些月份（消息=2023-09、日志/相册/相片=2023-09，分享/视频=2023-10）
        expect(stat.monthly.map((m) => m.key)).toEqual(['2023-09', '2023-10']);
    });

    it('我访问统计来自各条目自身的浏览者名单（custom_visitor.list）', () => {
        // 模拟「我」浏览过的条目：每条条目的 custom_visitor.list 含浏览者（uin 命中即为我浏览）
        const messages: Record<string, any>[] = [
            // 老张（非我）浏览，不计入
            { tid: 'm1', custom_visitor: { list: [{ uin: TARGET, name: '芷炫' }] } },
            // 我浏览了这条说说
            { tid: 'm2', custom_visitor: { list: [{ uin: OWNER, name: '老王' }, { uin: TARGET, name: '芷炫' }] } },
        ];
        const blogs: Record<string, any>[] = [
            // 我浏览了这篇日志
            { blogid: 'b1', custom_visitor: { list: [{ uin: OWNER, name: '老王' }] } },
        ];
        const albums: Record<string, any>[] = [
            // 我浏览了这个相册
            { id: 'a1', custom_visitor: { list: [{ uin: OWNER, name: '老王' }] } },
        ];
        const shares: Record<string, any>[] = [
            // 我浏览了这条分享
            { id: 's1', custom_visitor: { list: [{ uin: OWNER, name: '老王' }] } },
        ];

        const stat = computeOwnerTargetInteraction(OWNER, TARGET, messages, [], blogs, albums, shares, []);

        // 我访问：1 说说 + 1 日志 + 1 相册 + 1 分享 = 4
        expect(stat.myVisits).toBe(4);
        expect(stat.myVisitBreakdown).toEqual({ message: 1, blog: 1, album: 1, share: 1 });
        // 「我访问」是浏览而非主动互动，不计入互动总量与方向计数
        expect(stat.totalInteractions).toBe(0);
        expect(stat.fromMe).toBe(0);
    });

    it('统计卡片数字与按 (category,dir) 筛选的明细条数同源（issue 1–4 回归）', () => {
        // 构造「旧计数口径会膨胀」的场景：
        //  - 同一说说被好友连留 3 条评论（旧逻辑按「动作次数」会记 3，应记 1 个评论线程）
        //  - 同一条留言板好友既发帖又回复（旧逻辑会记 2，应记 1 个留言板线程）
        const messages: Record<string, any>[] = [
            {
                tid: 'msg-1',
                created_time: 1700000000,
                custom_comments: [
                    { uin: OWNER, name: '老王', postTime: 1700000000, replies: [{ uin: TARGET, name: '芷炫', postTime: 1700000500 }] },
                    { uin: OWNER, name: '老王', postTime: 1700000100, replies: [] },
                    { uin: OWNER, name: '老王', postTime: 1700000200, replies: [] },
                ],
                likes: [{ fuin: OWNER, nickname: '老王', create_time: 1700000000 }],
            },
        ];
        const boards: Record<string, any>[] = [
            {
                id: 'board-1',
                uin: OWNER, // 好友是作者
                name: '老王',
                pubtime: 1690000000,
                replyList: [{ uin: OWNER, name: '老王', time: 1690000500 }], // 好友又回复了
            },
        ];

        const stat = computeOwnerTargetInteraction(OWNER, TARGET, messages, boards, []);

        // 每条 events 都带 category 字段（供明细精确筛选）
        expect(stat.events.every((e) => typeof e.category === 'string')).toBe(true);

        // 同源不变量：每张卡片数字 == 按 (category, dir) 筛选出的 events 数
        const byCat = (cat: string, dir: string) =>
            stat.events.filter((e) => e.category === cat && e.dir === dir).length;

        expect(stat.myComments).toBe(1); // 同一说说 3 条评论 → 1 个评论线程
        expect(stat.myComments).toBe(byCat('comment', 'me'));

        expect(stat.myLikes).toBe(1);
        expect(stat.myLikes).toBe(byCat('like', 'me'));

        expect(stat.myBoards).toBe(1); // 同一留言板既发帖又回复 → 1 个留言板线程
        expect(stat.myBoards).toBe(byCat('board', 'me'));

        expect(stat.taReplies).toBe(1); // 仅 1 条评论回复
        expect(stat.taReplies).toBe(byCat('reply', 'ta'));

        // 点击卡片后明细筛选条数 == 卡片数字（category 与列表同源）
        expect(byCat('comment', 'me')).toBe(stat.myComments);
        expect(byCat('board', 'me')).toBe(stat.myBoards);
    });

    it('self 模式（好友对我）：统计卡片数字与 (category,dir) 筛选同源，与 other 模式共用同一规则', () => {
        // 镜像 other 模式的 fixture：把主语互换——好友(owner=1334122472) 主动留言/评论/点赞，
        // 我(target=10001) 回应好友。验证「card 数字 == 按 (category,dir) 筛选的 events 数」这一
        // 不变量在 self 模式下同样成立，证明两种模式用的是同一条 owner-relative 规则（维度主语互换而已）。
        const FRIEND = TARGET; // 1334122472，作为 owner
        const ME = OWNER;      // 10001，作为 target
        const messages: Record<string, any>[] = [
            {
                tid: 'msg-1',
                created_time: 1700000000,
                custom_comments: [
                    {
                        uin: FRIEND,
                        name: '芷炫',
                        postTime: 1700000000,
                        replies: [{ uin: ME, name: '老王', postTime: 1700001000 }],
                    },
                ],
                likes: [{ fuin: FRIEND, nickname: '芷炫', create_time: 1700000000 }],
            },
        ];
        const boards: Record<string, any>[] = [
            {
                id: 'board-1',
                uin: FRIEND,
                name: '芷炫',
                pubtime: 1690000000,
                replyList: [{ uin: ME, name: '老王', time: 1690001000 }],
            },
        ];

        const stat = computeOwnerTargetInteraction(FRIEND, ME, messages, boards, []);

        const byCat = (cat: string, dir: string) =>
            stat.events.filter((e) => e.category === cat && e.dir === dir).length;

        // self 模式下 owner=好友：其主动行为对应卡片「TA 留言 / TA 评论 / TA 点赞」，我回应=「我回应」。
        // 点击 emit 的 (category, dir) 与聚合公式完全一致——无 mode 分支，故两种模式数字同源。
        expect(stat.myBoards).toBe(byCat('board', 'me'));    // 好友留言
        expect(stat.myComments).toBe(byCat('comment', 'me')); // 好友评论
        expect(stat.taReplies).toBe(byCat('reply', 'ta'));    // 我回应好友
        expect(stat.myLikes).toBe(byCat('like', 'me'));      // 好友点赞

        // 与 other 模式同一套 fixture 对称（好友1留言 + 1评论 + 1点赞，我回应1次(说说)+1次(留言板)）
        expect(stat.myBoards).toBe(1);
        expect(stat.myComments).toBe(1);
        expect(stat.taReplies).toBe(2); // 说说评论下的回复 + 留言板下的回复
        expect(stat.myLikes).toBe(1);
        // 四张卡片数字之和 == 互动总量（同源，无重复/遗漏）
        expect(stat.totalInteractions).toBe(5);
    });
});
