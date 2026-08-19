/**
 * 生成查看器开发用的样例备份数据（viewer/mock/）
 *
 * 结构与真实备份包一致（Common/json/user.js、Messages/json/messages.js ...），
 * 数据文件同样是 `window.xxx = [...]` 形式，这样查看器的加载路径与线上完全相同，
 * 无需真实备份即可验证展示效果。
 *
 * 用法：node scripts/gen-viewer-mock.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../viewer/mock');

/** 写入 window.<key> = <json> 形式的数据文件 */
function writeData(file, key, value) {
    const target = resolve(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'window.' + key + ' = ' + JSON.stringify(value, null, 0));
}

/** 用在线占位图，仅开发预览用；真实备份里是本地相对路径 */
const IMG = (seed, size = 400) => `https://picsum.photos/seed/${seed}/${size}/${size}`;

const MOCK_UIN = 1334122472;

/** 秒级时间戳（备份数据里的 created_time 就是秒） */
function ts(year, month, day, hour = 12) {
    return Math.floor(new Date(year, month - 1, day, hour).getTime() / 1000);
}

const messages = [
    {
        tid: 'msg-1',
        uin: MOCK_UIN,
        name: '芷炫',
        created_time: ts(2024, 8, 15, 21),
        content: '广州的夏天，晚风终于凉了一点。\n随手拍了两张，记录一下。',
        likeTotal: 13,
        // 模拟「我（备份操作者）点赞了 TA 的说说」，用于演示「我与 TA 的互动」看板
        likes: [{ fuin: 10001, nickname: '老王', create_time: ts(2024, 8, 15, 21) }],
        custom_visitor: { viewCount: 233 },
        lbs: { idname: '广州塔', name: '广州市海珠区', pos_x: '113.32', pos_y: '23.11' },
        custom_images: [
            { pic_id: 'p1', custom_url: IMG('summer1') },
            { pic_id: 'p2', custom_url: IMG('summer2') },
        ],
        custom_comments: [
            {
                uin: 10001,
                name: '老王',
                postTime: ts(2024, 8, 15, 22),
                content: '这张构图不错啊！',
                pic: [{ custom_url: IMG('comment1', 200) }],
                replies: [
                    { uin: MOCK_UIN, name: '芷炫', postTime: ts(2024, 8, 15, 23), content: '谢谢，随手拍的' },
                ],
            },
            { uin: 10002, name: '小李', create_time: ts(2024, 8, 16, 9), content: '求原图', private: 1 },
        ],
    },
    {
        tid: 'msg-2',
        uin: MOCK_UIN,
        name: '芷炫',
        created_time: ts(2024, 5, 2, 10),
        content: '转发一条旧回忆。',
        rt_tid: 'msg-old',
        rt_uin: 20001,
        rt_uinname: '青春纪念册',
        rt_con: '十年前的今天，我们在操场上拍了这张合照。',
        likeTotal: 3,
        custom_visitor: { viewCount: 51 },
        custom_images: [{ pic_id: 'p3', custom_url: IMG('memory') }],
        custom_comments: [],
    },
    {
        tid: 'msg-3',
        uin: MOCK_UIN,
        name: '芷炫',
        created_time: ts(2023, 12, 31, 23),
        content: '2023 最后一条说说，附一段视频。',
        likeTotal: 30,
        custom_visitor: { viewCount: 812 },
        custom_videos: [
            {
                video_id: 'v1',
                // 开发预览用的公开测试视频；真实备份里是本地文件相对路径
                custom_url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
                custom_pre_url: IMG('video-poster'),
            },
        ],
        custom_comments: [
            { uin: 10003, name: '小张', postTime: ts(2024, 1, 1, 0), content: '新年快乐！' },
        ],
    },
];

const userInfo = {
    uin: MOCK_UIN,
    nickname: '芷炫',
    // 模拟「查看他人空间的备份」：备份操作者(ownerUin) 与 空间主人(uin) 不一致
    ownerUin: 10001,
    isOwner: false,
    spacename: '芷炫的QQ空间',
    desc: '落叶随风，青春，稍纵即逝。',
    avatar: '',
    // 空间资料：供查看器「空间资料」面板预览（与真实 user.js 字段一致）
    sex: 2,
    birthday: '06-20',
    constellation: 2,
    bloodtype: 0,
    marriage: 1,
    country: '中国',
    province: '广东',
    city: '茂名',
    hco: '中国',
    hp: '广东',
    hc: '湛江',
    company: '还没有',
    signature: '[url=http://qzone.qq.com][ft=#ff0000,,楷体_GB2312][I]传说对着流星可以许愿[/I][/ft][/url]',
    messages: messages.length,
    blogs: 2,
    diaries: 1,
    photos: 3,
    videos: 2,
    boards: 2,
    friends: 3,
    favorites: 2,
    shares: 2,
    visitors: 2,
};

/** 日志与日记：正文为 base64 的 HTML（与采集端 custom_html 一致） */
function toBase64(text) {
    return Buffer.from(text, 'utf8').toString('base64');
}

const blogs = [
    {
        blogid: 'blog-1',
        title: '关于重构的一些想法',
        category: '技术',
        pubtime: ts(2024, 3, 12, 20),
        likeTotal: 5,
        custom_visitor: { viewCount: 120 },
        custom_html: toBase64('<p>重构不是重写，而是在不改变外部行为的前提下改善内部结构。</p>'
            + '<p><img src="../Blogs/images/demo.png" alt="示例图" /></p>'),
        comments: [
            { uin: 10001, name: '老王', postTime: ts(2024, 3, 12, 21), content: '写得好' },
        ],
    },
    {
        blogid: 'blog-2',
        title: '十年前的今天',
        category: '生活',
        pubtime: ts(2019, 9, 1, 8),
        likeTotal: 18,
        custom_visitor: { viewCount: 640 },
        custom_html: toBase64('<p>第一天上学，背着书包站在校门口。</p>'),
        comments: [],
    },
];

const diaries = [
    {
        blogid: 'diary-1',
        title: '一些不想公开的记录',
        pubtime: ts(2022, 6, 18, 23),
        likeTotal: 0,
        custom_visitor: { viewCount: 1 },
        custom_html: toBase64('<p>今天心情不错。</p>'),
        comments: [],
    },
];

const albums = [
    {
        id: 'album-1',
        name: '广州之旅',
        className: '旅行',
        total: 2,
        custom_url: IMG('album-cover-1', 300),
        photoList: [
            {
                uniKey: 'photo-1',
                name: '广州塔',
                custom_url: IMG('photo1'),
                uploadtime: ts(2024, 8, 15, 20),
                rawshoottime: ts(2024, 8, 15, 19),
                custom_lbs: { idname: '广州塔' },
                likes: [{ uin: 10001 }],
                comments: [{ uin: 10001, name: '老王', postTime: ts(2024, 8, 16, 9), content: '好看' }],
            },
            {
                uniKey: 'photo-2',
                name: '珠江夜景',
                custom_url: IMG('photo2'),
                uploadtime: ts(2024, 8, 15, 21),
                likes: [],
                comments: [],
            },
        ],
    },
    {
        id: 'album-2',
        name: '成长记录',
        className: '其他',
        total: 1,
        custom_url: IMG('album-cover-2', 300),
        photoList: [
            {
                uniKey: 'photo-3',
                name: '幼儿园合照',
                custom_url: IMG('photo3'),
                uploadtime: ts(2010, 6, 1, 10),
                likes: [],
                comments: [],
            },
        ],
    },
    {
        id: 'album-3',
        name: '自己整理的图',
        className: '本地图片',
        isLocal: true,
        total: 0,
        photoList: [],
    },
];

const videos = [
    {
        uniKey: 'video-1',
        name: '跳舞片段',
        desc: '运动会开场表演',
        uploadTime: ts(2023, 11, 5, 15),
        custom_url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        custom_pre_url: IMG('video1-poster'),
        likes: [{ uin: 10002 }],
        comments: [],
    },
    {
        uniKey: 'video-2',
        name: '日落延时',
        uploadTime: ts(2022, 7, 20, 19),
        custom_url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        custom_pre_url: IMG('video2-poster'),
        likes: [],
        comments: [{ uin: 10003, name: '小张', postTime: ts(2022, 7, 21, 8), content: '很美' }],
    },
];

const boards = [
    {
        id: 'board-1',
        uin: 10001,
        nickname: '老王',
        pubtime: ts(2024, 1, 2, 12),
        htmlContent: '新年快乐！记得请吃饭。',
        replyList: [
            { uin: MOCK_UIN, name: '芷炫', time: ts(2024, 1, 2, 13), content: '安排！' },
        ],
    },
    {
        id: 'board-2',
        uin: 10002,
        nickname: '小李',
        pubtime: ts(2021, 5, 20, 20),
        htmlContent: '路过，留个脚印。',
        replyList: [],
    },
];

const friends = [
    {
        uin: 10001,
        name: '老王',
        remark: '大学室友',
        groupName: '同学',
        care: 1,
        isFriend: 1,
        addFriendTime: ts(2012, 9, 1, 9),
        intimacyScore: 860,
        common: { friend: 12, group: ['寝室群', '班群'] },
    },
    {
        uin: 10002,
        name: '小李',
        remark: '',
        groupName: '同事',
        care: 0,
        isFriend: 0,
        addFriendTime: ts(2019, 3, 15, 14),
        intimacyScore: 120,
        common: { friend: 2, group: [] },
    },
    {
        uin: 10003,
        name: '小张',
        groupName: '',
        care: 0,
        isFriend: 1,
        addFriendTime: 0,
        intimacyScore: 0,
        common: {},
    },
];

const favorites = [
    {
        id: 'fav-1',
        type: 5,
        custom_create_time: ts(2023, 4, 8, 11),
        shuoshuo_info: {
            reason: '写得真好，收起来',
            detail_shuoshuo_info: { content: '人生就像一盒巧克力。' },
        },
    },
    {
        id: 'fav-2',
        type: 7,
        title: '一篇值得看的文章',
        abstract: '关于如何做好数据备份的实践总结。',
        custom_create_time: ts(2020, 10, 1, 16),
        share_info: { reason: '' },
    },
];

const shares = [
    {
        id: 'share-1',
        uin: MOCK_UIN,
        nickname: '芷炫',
        shareTime: ts(2024, 2, 14, 18),
        desc: '这首歌很适合今天。',
        custom_source_name: 'QQ音乐',
        source: {
            title: '消愁',
            desc: '周杰伦 - 叶惠美',
            url: 'https://y.qq.com/',
            images: [{ custom_url: IMG('share-music', 300) }],
        },
        comments: [],
    },
    {
        id: 'share-2',
        uin: MOCK_UIN,
        nickname: '芷炫',
        shareTime: ts(2018, 12, 25, 9),
        desc: '',
        custom_source_name: '哔哩哔哩',
        source: {
            title: '一个有趣的视频',
            url: 'https://www.bilibili.com/',
            images: [],
        },
        comments: [{ uin: 10001, name: '老王', postTime: ts(2018, 12, 25, 10), content: '看过，不错' }],
    },
];

const visitorInfo = {
    total: 2,
    items: [
        {
            uin: 10001,
            name: '老王',
            time: ts(2024, 8, 16, 10),
            shuoshuoes: [{ title: '广州的夏天，晚风终于凉了一点' }],
            photoes: [{ custom_url: IMG('visited-photo', 200) }],
            blogs: [],
            shares: [],
        },
        {
            uin: 10002,
            name: '小李',
            time: ts(2024, 7, 1, 22),
            shuoshuoes: [],
            photoes: [],
            blogs: [],
            shares: [],
        },
    ],
};

// 全局变量名必须与采集端 writeJsonToJs(全局名, ...) 完全一致，否则样例数据会掩盖
// 查看器读错变量名的问题（曾因 boards/config 猜名导致真实备份打开是空的）
writeData('Common/json/user.js', 'userInfo', userInfo);
// 纯 JSON 副本（与导出端 exportUserProfile 一致，便于二次处理/跨平台解析）
writeFileSync(resolve(root, 'Common/json/user.json'), JSON.stringify(userInfo, null, 2));
writeData('Common/json/config.js', 'QZone_Config', {
    Common: { mediaMode: 'Download', downloadType: 'Disk' },
    Messages: { exportType: 'HTML' },
    Blogs: { showType: '1', viewType: '1' },
    Diaries: { showType: '1' },
    Friends: { showType: '1' },
});
writeData('Messages/json/messages.js', 'messages', messages);
writeData('Blogs/json/blogs.js', 'blogs', blogs);
writeData('Diaries/json/diaries.js', 'diaries', diaries);
writeData('Albums/json/albums.js', 'albums', albums);
writeData('Videos/json/videos.js', 'videos', videos);
// 留言是带主人寄语与总数的对象
writeData('Boards/json/boards.js', 'boardInfo', {
    authorInfo: { message: '欢迎来我的空间，随便坐。' },
    total: boards.length,
    items: boards,
});
writeData('Friends/json/friends.js', 'friends', friends);
writeData('Favorites/json/favorites.js', 'favorites', favorites);
writeData('Shares/json/shares.js', 'shares', shares);
writeData('Visitors/json/visitors.js', 'visitorInfo', visitorInfo);

console.log('样例数据已生成：viewer/mock');
