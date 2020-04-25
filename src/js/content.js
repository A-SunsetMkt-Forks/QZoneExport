/**
 * Ajax下载任务
 */
class DownloadTask {

    /**
     * @param {string} dir 下载目录
     * @param {string} name 文件名，包含后缀
     * @param {string} url 文件地址
     * @param {object} source 文件来源
     */
    constructor(dir, name, url, source) {
        this.dir = dir
        this.name = name
        this.url = url
        this.downloadState = 'in_progress'
        this.source = source
    }

    /**
     * 设置下载状态
     * @param {string} downloadState 下载状态
     */
    setState(downloadState) {
        this.downloadState = downloadState;
    }
}

/**
 * 迅雷任务
 */
class ThunderTask {

    /**
     * 
     * @param {string} dir 下载目录
     * @param {string} name 文件名，包含后缀
     * @param {string} url 文件地址
     * @param {object} source 文件来源
     */
    constructor(dir, name, url, source) {
        this.dir = dir
        this.name = name
        this.url = url
        this.downloadState = 'in_progress'
        this.source = source
    }

    /**
     * 设置下载状态
     * @param {string} downloadState 下载状态
     */
    setState(downloadState) {
        this.downloadState = downloadState;
    }
}

/**
 * 迅雷任务信息
 */
class ThunderInfo {

    /**
     * 
     * @param {string} dir 下载目录
     * @param {integer} threadCount 下载
     * @param {ThunderTask} tasks 任务
     */
    constructor(taskGroupName, threadCount, tasks) {
        this.taskGroupName = taskGroupName
        this.tasks = tasks || []
        this.threadCount = threadCount
    }

    /**
    * 添加下载任务
    * @param {ThunderTask} task 任务
    */
    addTask(task) {
        this.tasks.push(task);
    }

    /**
     * 删除指定索引任务
     * @param {integer} index 数组索引
     */
    delTask(index) {
        this.tasks.splice(index, 1);
    }

    /**
     * 根据下载链接删除任务
     * @param {string} url 下载链接
     */
    removeTask(url) {
        this.tasks.remove(url, 'url')
    }
}

/**
 * 浏览器下载任务
 */
class BrowserTask {

    /**
     * 
     * @param {string} url 下载地址
     * @param {string} root 下载根目录名称
     * @param {string} folder 根目录相对名称
     * @param {string} name 文件名称
     * @param {object} source 文件来源
     */
    constructor(url, root, folder, name, source) {
        this.id = 0;
        this.url = url;
        this.dir = folder;
        this.name = name;
        this.filename = root + '/' + folder + '/' + name;
        this.downloadState = 'in_progress'
        this.source = source
    }

    /**
     * 设置下载管理器ID
     * @param {integer} id 下载管理器ID
     */
    setId(id) {
        this.id = id
    }

    /**
     * 设置下载状态
     * @param {string} downloadState 下载状态
     */
    setState(downloadState) {
        this.downloadState = downloadState;
    }
}

/**
 * 提示信息
 */
const MAX_MSG = {
    Messages: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 页的说说列表',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Messages_Full_Content: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 条说说的全文',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Messages_Comments: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 条说说的评论列表',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Messages_Export: [
        '正在导出说说',
        '已导出 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Blogs: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 页的日志列表',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 篇',
        '已失败 <span style="color: red;">{downloadFailed}</span> 篇',
        '总共 <span style="color: #1ca5fc;">{total}</span> 篇',
        '请稍后...'
    ],
    Blogs_Content: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 篇的日志内容',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 篇',
        '已失败 <span style="color: red;">{downloadFailed}</span> 篇',
        '总共 <span style="color: #1ca5fc;">{total}</span> 篇',
        '请稍后...'
    ],
    Blogs_Comments: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 篇日志的评论列表',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Blogs_Export: [
        '正在导出日志',
        '已导出 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Diaries: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 页的私密日记列表',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 篇',
        '已失败 <span style="color: red;">{downloadFailed}</span> 篇',
        '总共 <span style="color: #1ca5fc;">{total}</span> 篇',
        '请稍后...'
    ],
    Diaries_Content: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 篇的私密日记内容',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 篇',
        '已失败 <span style="color: red;">{downloadFailed}</span> 篇',
        '总共 <span style="color: #1ca5fc;">{total}</span> 篇',
        '请稍后...'
    ],
    Diaries_Export: [
        '正在导出私密日记',
        '已导出 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Photos: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 页的相册列表',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 个',
        '已失败 <span style="color: red;">{downloadFailed}</span> 个',
        '总共 <span style="color: #1ca5fc;">{total}</span> 个',
        '请稍后...'
    ],
    Photos_Albums_Comments: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 个相册的评论列表',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 个',
        '已失败 <span style="color: red;">{downloadFailed}</span> 个',
        '总共 <span style="color: #1ca5fc;">{total}</span> 个',
        '请稍后...'
    ],
    Photos_Images: [
        '正在获取 <span style="color: #1ca5fc;">{index}</span> 的相片列表',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 张',
        '已失败 <span style="color: red;">{downloadFailed}</span> 张',
        '总共 <span style="color: #1ca5fc;">{total}</span> 张',
        '请稍后...'
    ],
    Photos_Images_Info: [
        '正在获取 <span style="color: #1ca5fc;">{index}</span> 的相片详情',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 张',
        '已失败 <span style="color: red;">{downloadFailed}</span> 张',
        '总共 <span style="color: #1ca5fc;">{total}</span> 张',
        '请稍后...'
    ],
    Photos_Images_Comments: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 张相片的评论列表',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Photos_Images_Mime: [
        '正在获取 <span style="color: #1ca5fc;">{index}</span> 的相片类型',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 张',
        '已失败 <span style="color: red;">{downloadFailed}</span> 张',
        '总共 <span style="color: #1ca5fc;">{total}</span> 张',
        '请稍后...'
    ],
    Photos_Export: [
        '正在导出相册',
        '已导出 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Photos_Images_Export: [
        '正在导出 <span style="color: #1ca5fc;">{index}</span> 的相片',
        '已导出 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Videos: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 页的视频列表',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 个',
        '已失败 <span style="color: red;">{downloadFailed}</span> 个',
        '总共 <span style="color: #1ca5fc;">{total}</span> 个',
        '请稍后...'
    ],
    Videos_Export: [
        '正在导出视频',
        '已导出 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Boards: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 页的留言板列表',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Boards_Export: [
        '正在导出 <span style="color: #1ca5fc;">{index}</span> 年的留言',
        '已导出 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Friends: [
        '正在获取QQ好友列表',
        '已获取好友 <span style="color: #1ca5fc;">{downloaded}</span> 个',
        '总共 <span style="color: #1ca5fc;">{total}</span> 个',
        '请稍后...'
    ],
    Friends_Time: [
        '正在获取好友添加时间',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 个',
        '总共 <span style="color: #1ca5fc;">{total}</span> 个',
        '请稍后...'
    ],
    Friends_Export: [
        '正在导出QQ好友列表',
        '已导出好友 <span style="color: #1ca5fc;">{downloaded}</span> 个',
        '总共 <span style="color: #1ca5fc;">{total}</span> 个',
        '请稍后...'
    ],
    Favorites: [
        '正在获取第 <span style="color: #1ca5fc;">{index}</span> 页的收藏列表',
        '已获取 <span style="color: #1ca5fc;">{downloaded}</span> 个',
        '已失败 <span style="color: red;">{downloadFailed}</span> 个',
        '总共 <span style="color: #1ca5fc;">{total}</span> 个',
        '请稍后...'
    ],
    Favorites_Export: [
        '正在导出 <span style="color: #1ca5fc;">{index}</span> 年的收藏',
        '已导出 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '已失败 <span style="color: red;">{downloadFailed}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Common_File: [
        '正在下载文件',
        '已下载 <span style="color: #1ca5fc;">{downloaded}</span> ',
        '已失败 <span style="color: red;">{downloadFailed}</span> ',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Common_Thunder: [
        '正在第 <span style="color: #1ca5fc;">{index}</span> 次唤起迅雷X下载文件',
        '将在 <span style="color: #1ca5fc;">{nextTip}</span> 秒后再次唤起迅雷',
        '已添加 <span style="color: #1ca5fc;">{downloaded}</span> ',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ],
    Common_Browser: [
        '正在添加下载任务到浏览器',
        '已添加 <span style="color: #1ca5fc;">{downloaded}</span> 条',
        '总共 <span style="color: #1ca5fc;">{total}</span> 条',
        '请稍后...'
    ]
}

/**
 * 备份进度
 */
class StatusIndicator {

    /**
     * 
     * @param {string} type 导出类型
     */
    constructor(type) {
        this.id = type + '_Tips'
        this.type = type
        this.tip = MAX_MSG[type] || ''
        this.total = 0
        this.index = 0
        this.pageSize = 0
        this.nextTip = 0
        this.downloaded = 0
        this.downloading = 0
        this.downloadFailed = 0
    }

    /**
     * 获取数据
     */
    getData(dataType) {
        return this.data[dataType] || []
    }


    /**
     * 输出提示信息
     */
    print() {
        let $tip_dom = $("#" + this.id);
        $tip_dom.show();
        $tip_dom.html(this.tip.join('，').format(this));
    }

    /**
     * 完成
     * @param {object} params 格式化参数
     */
    complete() {
        let $tip_dom = $("#" + this.id)
        $tip_dom.show()
        $tip_dom.html(this.tip.join('，').format(this).replace('正在', '已').replace('请稍后', '已完成'))
    }

    /**
     * 下载
     */
    addDownload(pageSize) {
        this.downloading = this.downloaded + pageSize
        this.print()
    }

    /**
     * 下载失败
     */
    addFailed(item) {
        let count = 1
        if (Array.isArray(item)) {
            count = item.length
        }
        if (item['isPage']) {
            count = item['pageSize']
        }
        this.downloadFailed = this.downloadFailed + (count * 1)
        this.downloading = this.downloading - (count * 1)
        this.print()
    }

    /**
     * 下载失败
     */
    setFailed(item) {
        let count = 1
        if (Array.isArray(item)) {
            count = item.length
        }
        if (item['isPage']) {
            count = item['pageSize']
        }
        this.downloadFailed = count;
        this.downloading = 0
        this.print()
    }

    /**
     * 下载成功
     */
    addSuccess(item) {
        let count = 1
        if (Array.isArray(item)) {
            count = item.length;
        }
        if (typeof item === 'number') {
            count = item;
        }
        this.downloaded = this.downloaded + (count * 1)
        this.downloading = this.downloading - (count * 1)
        this.print()
    }


    /**
     * 下载成功
     */
    setSuccess(item) {
        let count = 1
        if (Array.isArray(item)) {
            count = item.length;
        }
        if (typeof item === 'number') {
            count = item;
        }
        this.downloaded = count
        this.downloading = 0
        this.print()
    }

    /**
     * 设置当前位置
     * @param {object} index 当前位置
     */
    setIndex(index) {
        this.index = index
        this.print()
    }

    /**
     * 设置总数
     * @param {integer} total
     */
    setTotal(total) {
        this.total = total
        this.print()
    }

    /**
     * 设置下一步提示
     * @param {string} tip
     */
    setNextTip(tip) {
        this.nextTip = tip
        this.print()
    }
}


/**
 * 操作类型
 */
const OperatorType = {

    /**
     * 初始化
     */
    INIT: 'INIT',
    /**
     * 显示弹窗
     */
    SHOW: 'SHOW',

    /**
     * 获取用户个人档信息
     */
    USER_INFO: 'USER_INFO',

    /**
     * 获取所有说说列表
     */
    MESSAGES_LIST: 'MESSAGES_LIST',

    /**
     * 获取日志所有列表
     */
    BLOG_LIST: 'BLOG_LIST',

    /**
     * 获取私密日记所有列表
     */
    DIARY_LIST: 'DIARY_LIST',

    /**
    * 获取相册照片
    */
    PHOTO_LIST: 'PHOTO_LIST',

    /**
    * 获取视频列表
    */
    VIDEO_LIST: 'VIDEO_LIST',

    /**
    * 获取留言板列表
    */
    BOARD_LIST: 'BOARD_LIST',

    /**
    * 获取QQ好友列表
    */
    FRIEND_LIST: 'FRIEND_LIST',

    /**
    * 获取收藏列表
    */
    FAVORITE_LIST: 'FAVORITE_LIST',

    /**
     * 下载文件
     */
    FILE_LIST: 'FILE_LIST',

    /**
     * 压缩
     */
    ZIP: 'ZIP',

    /**
     * 压缩
     */
    COMPLETE: 'COMPLETE'
}

/**
 * 导出操作
 */
class QZoneOperator {

    /**
     * 下一步操作
     */
    async next(moduleType) {
        switch (moduleType) {
            case OperatorType.INIT:
                this.init();
                break;
            case OperatorType.SHOW:
                // 显示模态对话框
                await this.showProcess();
                await this.initModelFolder();
                this.next(OperatorType.MESSAGES_LIST);
                break;
            case OperatorType.MESSAGES_LIST:
                // 获取说说列表
                if (this.isExport(moduleType)) {
                    await API.Messages.export();
                }
                this.next(OperatorType.BLOG_LIST);
                break;
            case OperatorType.BLOG_LIST:
                // 获取日志列表
                if (this.isExport(moduleType)) {
                    await API.Blogs.export();
                }
                this.next(OperatorType.DIARY_LIST);
                break;
            case OperatorType.DIARY_LIST:
                // 获取私密日记列表
                if (this.isExport(moduleType)) {
                    await API.Diaries.export();
                }
                this.next(OperatorType.PHOTO_LIST);
                break;
            case OperatorType.PHOTO_LIST:
                // 获取相册列表
                if (this.isExport(moduleType)) {
                    await API.Photos.export();
                }
                this.next(OperatorType.VIDEO_LIST);
                break;
            case OperatorType.VIDEO_LIST:
                // 获取视频列表
                if (this.isExport(moduleType)) {
                    await API.Videos.export();
                }
                this.next(OperatorType.BOARD_LIST);
                break;
            case OperatorType.BOARD_LIST:
                // 获取留言列表
                if (this.isExport(moduleType)) {
                    await API.Boards.export();
                }
                this.next(OperatorType.FRIEND_LIST);
                break;
            case OperatorType.FRIEND_LIST:
                // 获取QQ好友列表
                if (this.isExport(moduleType)) {
                    await API.Friends.export();
                }
                this.next(OperatorType.FAVORITE_LIST);
                break;
            case OperatorType.FAVORITE_LIST:
                // 获取收藏列表
                if (this.isExport(moduleType)) {
                    await API.Favorites.export();
                }
                this.next(OperatorType.USER_INFO);
                break;
            case OperatorType.USER_INFO:
                // 获取目标用户个人档信息
                await API.Common.exportUser();
                this.next(OperatorType.FILE_LIST);
                break;
            case OperatorType.FILE_LIST:
                // 保存数据
                chrome.storage.local.set(QZone, function () {
                    console.info("保存数据完成", QZone);
                });
                // 下载文件
                await API.Utils.downloadAllFiles();
                this.next(OperatorType.ZIP);
                break;
            case OperatorType.ZIP:
                await API.Utils.sleep(1000);
                // 压缩
                await API.Utils.Zip(FOLDER_ROOT);
                operator.next(OperatorType.COMPLETE);
                break;
            case OperatorType.COMPLETE:
                // 延迟3秒，确保压缩完
                await API.Utils.sleep(1000);
                $("#downloadBtn").show();
                let tasks = API.Utils.getFailedTasks();
                if (tasks.length > 0) {
                    $("#fileList").show();
                }
                $("#backupStatus").html("数据采集完成，请下载。");
                API.Utils.notification("QQ空间导出助手通知", "空间数据已获取完成，请点击下载！");
                break;
            default:
                break;
        }
    }

    /**
     * 当前模块是否需要导出
     * @param {string} moduleType 当前模块
     */
    isExport(moduleType) {
        return QZone.Common.ExportType[moduleType];
    }


    /**
     * 初始化
     */
    init() {
        if (location.href.indexOf("qzone.qq.com") == -1 || location.protocol == 'filesystem:') {
            return;
        }

        // 获取gtk
        API.Utils.initGtk();
        // 获取Token
        API.Utils.getQzoneToken();
        // 获取QQ号
        API.Utils.initUin();
        // 获取相册路由
        API.Photos.getRoute();

        // 读取配置项
        chrome.storage.sync.get(Default_Config, function (item) {
            Qzone_Config = item;
        })

        // 初始化文件夹
        QZone.Common.Filer.init({ persistent: false, size: 10 * 1024 * 1024 * 1024 }, function (fs) {
            QZone.Common.Filer.ls(FOLDER_ROOT, function (entries) {
                console.debug('当前子目录：', entries);
                QZone.Common.Filer.rm(FOLDER_ROOT, function () {
                    console.debug('清除历史数据成功！');
                });
            });
        })
    }

    /**
     * 初始化各个备份模块的文件夹
     */
    async initModelFolder() {
        console.debug('初始化模块文件夹开始', QZone);

        // 切换到根目录
        let root = await API.Utils.siwtchToRoot();
        console.debug("切换到根目录", root);
        // 创建模块文件夹
        let createModuleFolder = async function () {
            // 创建所有模块的目录
            for (let x in QZone) {
                let obj = QZone[x];
                if (typeof (obj) !== "object") {
                    continue;
                }
                let rootPath = obj['IMAGES_ROOT'] || obj['ROOT'];
                if (!rootPath) {
                    continue;
                }
                let entry = await API.Utils.createFolder(rootPath);
                console.debug('创建目录成功', entry);
            }
        }

        // 创建模块文件夹
        await createModuleFolder();

        // 创建说明文件
        let readmeUrl = chrome.runtime.getURL('others/README.md');
        let res = await API.Utils.get(readmeUrl);
        QZone.Common.Filer.write(FOLDER_ROOT + "说明.md", {
            data: res,
            type: "text/plain"
        }, (entry) => {
            console.debug('创建文件成功', entry);
        });
        console.debug('初始化模块文件夹结束', QZone);
    }

    /**
     * 显示备份进度窗口
     */
    async showProcess() {


        let html = await API.Utils.get(chrome.extension.getURL('html/indicator.html'));

        $('body').append(html);

        $('#exampleModalCenter').modal({
            backdrop: "static",
            keyboard: false
        })

        let $progressbar = $("#progressbar");
        let $downloadBtn = $('#downloadBtn');
        let $fileListBtn = $('#fileList');
        let $againDownloadBtn = $("#againDownload");
        let $browserDownloadBtn = $("#browserDownload");
        let $thunderDownloadBtn = $("#thunderDownload");

        // 下载方式
        let downloadType = Qzone_Config.Common.downloadType;
        switch (downloadType) {
            case 'Browser':
                // 下载方式为浏览器下载时隐藏【浏览器下载】按钮
                $browserDownloadBtn.hide();
                // 修改继续重试按钮文本为【唤起迅雷】
                $againDownloadBtn.text('继续重试');
                break;
            case 'Thunder':
                // 下载方式为迅雷下载时隐藏【迅雷下载】按钮
                $thunderDownloadBtn.hide();
                // 修改继续重试按钮文本为【唤起迅雷】
                $againDownloadBtn.text('唤起迅雷');
                break;
            default:
                $againDownloadBtn.text('继续重试');
                break;
        }

        // 【打包下载】按钮点击事件
        $downloadBtn.click(() => {

            $('#progress').show();
            $progressbar.css("width", "0%");
            $progressbar.attr("aria-valuenow", "0");
            $progressbar.text('已下载0%');

            $fileListBtn.attr('disabled', true);
            $downloadBtn.attr('disabled', true);
            $downloadBtn.text('正在下载');

            let zipName = QZone.Common.Config.ZIP_NAME + "_" + QZone.Common.Target.uin + ".zip";

            QZone.Common.Zip.generateAsync({ type: "blob" }, (metadata) => {
                $progressbar.css("width", metadata.percent.toFixed(2) + "%");
                $progressbar.attr("aria-valuenow", metadata.percent.toFixed(2));
                $progressbar.text('已下载' + metadata.percent.toFixed(2) + '%');
            }).then(function (content) {
                saveAs(content, zipName);
                $progressbar.css("width", "100%");
                $progressbar.attr("aria-valuenow", 100);
                $progressbar.text('已下载' + '100%');
                $downloadBtn.text('已下载');
                $downloadBtn.attr('disabled', false);
                $fileListBtn.attr('disabled', false);
                $("#showFolder").show();
                API.Utils.notification("QQ空间导出助手通知", "你的QQ空间数据下载完成！");
            });

        });

        // 【查看备份】按钮点击事件
        let $showFolder = $('#showFolder');
        $showFolder.click(() => {
            chrome.runtime.sendMessage({
                from: 'content',
                type: 'show_export_zip'
            });
        })

        //进度模式窗口隐藏后
        $('#exampleModalCenter').on('hidden.bs.modal', function () {
            $("#exampleModalCenter").remove();
            $("#modalTable").remove();
        })

        /**
         * 筛选数据
         * @param {string} value 过滤标识
         */
        const filterData = async function (value) {
            if (value === 'all') {
                $("#table").bootstrapTable('filterBy');
                return;
            }
            switch (downloadType) {
                case 'Browser':
                    // 下载方式为浏览器下载时
                    // 查询全部下载列表
                    let downlist = await API.Utils.getDownloadList(undefined);
                    for (const task of browserTasks) {
                        // 更新下载状态到表格
                        let index = downlist.getIndex(task.id, 'id');
                        if (index == -1) {
                            // 根据ID找下载项没找到表示没成功添加到浏览器中
                            task.downloadState = 'interrupted';
                            continue;
                        }
                        let downloadItem = downlist[index];
                        task.downloadState = downloadItem.state;
                    }
                    break;
                default:
                    break;
            }
            $("#table").bootstrapTable('filterBy', {
                downloadState: value
            })
        }

        // 查看指定状态的数据
        $('#statusFilter').change(function () {
            let value = $(this).val();
            if ('interrupted' === value || ('Thunder' === downloadType && 'all' === value)) {
                // 失败列表与迅雷下载全部列表时才展示【继续重试】按钮
                $againDownloadBtn.show();
            } else {
                $againDownloadBtn.hide();
            }
            filterData(value);
        })

        // 【重试】按钮点击事件
        $againDownloadBtn.click(async function () {
            let tasks = $('#table').bootstrapTable('getSelections');
            switch (downloadType) {
                case 'File':
                    // 下载方式为助手下载时
                    await API.Utils.downloadsByAjax(tasks)
                    // 重新压缩
                    operator.next(OperatorType.ZIP);
                    break;
                case 'Browser':
                    // 下载方式为浏览器下载时
                    for (const task of tasks) {
                        if (!task.id) {
                            // 无ID时表示添加到下载器失败，需要重新添加
                            await API.Utils.downloadByBrowser(task);
                            return;
                        }
                        await API.Utils.resumeDownload(task.id);
                    }
                    break;
                case 'Thunder':
                    // 下载方式为迅雷下载时
                    let newThunderInfo = new ThunderInfo(thunderInfo.taskGroupName, Qzone_Config.Common.downloadThread, tasks);
                    await API.Utils.invokeThunder(newThunderInfo)
                    break;
                default:
                    break;
            }
        })

        // 【迅雷下载】点击事件
        $("#thunderDownload").click(async function () {
            let tasks = $('#table').bootstrapTable('getSelections');
            let newThunderInfo = new ThunderInfo(thunderInfo.taskGroupName, Qzone_Config.Common.downloadThread);
            for (const task of tasks) {
                newThunderInfo.tasks.push(new ThunderTask(task.dir, task.name, API.Utils.toHttp(task.url)));
                task.setState('complete');
            }
            await API.Utils.invokeThunder(newThunderInfo)
        })

        // 【浏览器下载】点击事件
        $browserDownloadBtn.click(function () {
            let tasks = $('#table').bootstrapTable('getSelections');
            let newBrowserTasks = [];
            for (const task of tasks) {
                newBrowserTasks.push(new BrowserTask(API.Utils.toHttp(task.url), thunderInfo.taskGroupName, task.dir, task.name));
                task.setState('in_progress');
            }
            API.Utils.downloadsByBrowser(newBrowserTasks);
        })

        //显示下载任务列表
        $('#modalTable').on('shown.bs.modal', function () {

            // 重置筛选条件
            $('#statusFilter').val('interrupted');

            $("#table").bootstrapTable('destroy').bootstrapTable({
                undefinedText: '-',
                toggle: 'table',
                locale: 'zh-CN',
                search: true,
                searchAlign: 'right',
                height: "450",
                pagination: true,
                pageList: "[10, 20, 50, 100, 200, 500, 1000, 2000, 5000, All]",
                paginationHAlign: 'left',
                clickToSelect: true,
                paginationDetailHAlign: 'right',
                toolbar: '#toolbar',
                columns: [{
                    field: 'state',
                    checkbox: true,
                    align: 'left'
                }, {
                    field: 'name',
                    title: '名称',
                    titleTooltip: '名称',
                    align: 'left',
                    visible: true
                }, {
                    field: 'dir',
                    title: '路径',
                    titleTooltip: '路径',
                    align: 'left',
                    visible: true
                }, {
                    field: 'url',
                    title: '地址',
                    titleTooltip: '地址',
                    align: 'left',
                    visible: true,
                    formatter: (value) => {
                        return '<a target="_brank" href="{0}" >预览</a> '.format(API.Utils.makeViewUrl(value));
                    }
                }, {
                    field: 'source',
                    title: '来源',
                    titleTooltip: '来源',
                    align: 'left',
                    visible: true,
                    formatter: (value, row, index, field) => {
                        let type = API.Common.getSourceType(value);
                        switch (type) {
                            case 'Messages':
                                // 说说
                                return API.Utils.getLink(API.Messages.getUniKey(value.tid), '查看说说');
                            case 'Blogs':
                                // 日志
                                return API.Utils.getLink(API.Blogs.getUniKey(value.blogid), '查看日志');
                            case 'Diaries':
                                // 私密日记
                                return API.Utils.getLink('https://rc.qzone.qq.com/blog?catalog=private', '私密日记');
                            case 'Photos':
                                // 相册（暂无相册逻辑，直接查看照片即可）
                                return API.Utils.getLink('#', '无');
                            case 'Images':
                                // 相片
                                return API.Utils.getLink(API.Photos.getImageViewLink(value), '查看相片');
                            case 'Videos':
                                // 视频
                                return API.Utils.getLink(value.url, '查看视频');
                            case 'Boards':
                                // 留言板
                                return API.Utils.getLink('https://user.qzone.qq.com/{0}/334'.format(QZone.Common.Target.uin), '查看留言');
                            case 'Favorites':
                                // 收藏夹
                                return API.Utils.getLink('https://user.qzone.qq.com/{0}/favorite'.format(QZone.Common.Target.uin), '查看收藏');
                            default:
                                return API.Utils.getLink('#', '无');
                        }
                    }
                }],
                data: API.Utils.getDownloadTasks()
            })
            $('#table').bootstrapTable('resetView')

            // 默认加载失败的数据
            filterData("interrupted");
        })
    }
}

// 操作器
const operator = new QZoneOperator();
// Ajax下载任务
const downloadTasks = new Array();
// 迅雷下载信息
const thunderInfo = new ThunderInfo(QZone.Common.Config.ZIP_NAME);
// 浏览器下载信息
const browserTasks = new Array();

/**
 * 初始化监听
 */
(function () {

    // 消息监听
    chrome.runtime.onConnect.addListener(function (port) {
        console.debug("消息发送者：", port);
        switch (port.name) {
            case 'popup':
                port.onMessage.addListener(function (request) {
                    switch (request.subject) {
                        case 'startBackup':
                            QZone.Common.ExportType = request.exportType;
                            // 清空相册信息
                            QZone.Photos.Album.Data = [];
                            QZone.Photos.Album.Data = QZone.Photos.Album.Data.concat(request.albums || []);
                            // 显示进度窗口
                            operator.next(OperatorType.SHOW);
                            port.postMessage(QZone.Common.ExportType);
                            break;
                        case 'initUin':
                            // 获取QQ号
                            let res = API.Utils.initUin();
                            port.postMessage(res);
                            break;
                        case 'initDiaries':
                            // 获取私密日志
                            API.Diaries.getDiaries(0).then((data) => {
                                port.postMessage(API.Utils.toJson(data, /^_Callback\(/));
                            });
                            break;
                        case 'initModules':
                            // 获取上次勾选的模块
                            port.postMessage(QZone.Common.ExportType);
                            break;
                        case 'initAlbumInfo':
                            // 获取相册信息
                            API.Photos.getAlbums(0).then((data) => {
                                // 去掉函数，保留json
                                data = API.Utils.toJson(data, /^shine0_Callback\(/);
                                if (data.data && data.data.user && data.data.user.diskused) {
                                    data.data.user.capacity = API.Photos.getCapacityDisplay(data.data.user.diskused);
                                }
                                port.postMessage(data);
                            });
                            break;
                        case 'getAlbumList':
                            // 获取相册列表
                            API.Photos.getAllAlbumList().then((data) => {
                                port.postMessage(data);
                            });
                            break;
                        default:
                            break;
                    }
                });
                break;
            default:
                break;
        }
    });
    operator.next(OperatorType.INIT);

})()


/**
 * 添加下载任务
 * @param {string} image 对象
 * @param {string} url URL
 * @param {string} moudel_dir 模块下载目录
 * @param {object} source 来源
 * @param {string} FILE_URLS 文件下载链接
 */
API.Utils.addDownloadTasks = async (image, url, moudel_dir, source, FILE_URLS) => {
    let downloadType = Qzone_Config.Common.downloadType;
    let isQzoneUrl = downloadType === 'QZone';
    image.custom_url = url;
    if (isQzoneUrl) {
        return;
    }
    let filename = FILE_URLS.get(url);
    if (!filename) {
        filename = API.Utils.newSimpleUid(8, 16);
        let suffix = await API.Utils.autoFileSuffix(url);
        filename = filename + suffix;
        image.custom_mimeType = suffix;
    }
    image.custom_uid = filename;
    image.custom_dir = '图片';
    image.custom_filename = filename;
    image.custom_filepath = '图片/' + filename;
    // 添加下载任务
    API.Utils.newDownloadTask(url, moudel_dir, filename, source);
    FILE_URLS.set(url, filename);
}

/**
 * 添加下载任务
 * @param {url} url 下载地址
 * @param {folder} folder 下载相对目录
 * @param {name} name 文件名称
 * @param {object} source 文件来源
 */
API.Utils.newDownloadTask = (url, folder, name, source) => {
    url = API.Utils.makeDownloadUrl(url, true)

    // 添加Ajax请求下载任务
    downloadTasks.push(new DownloadTask(folder, name, API.Utils.toHttps(url), source));

    // 添加浏览器下载任务
    browserTasks.push(new BrowserTask(url, QZone.Common.Config.ZIP_NAME, folder, name, source));

    // 添加迅雷下载任务
    thunderInfo.addTask(new ThunderTask(folder, name, url, source));
}

/**
 * 通过Ajax请求下载文件
 * @param {Array} tasks
 */
API.Utils.downloadsByAjax = async (tasks) => {

    // 任务分组
    const _tasks = _.chunk(tasks, Qzone_Config.Common.downloadThread);

    let indicator = new StatusIndicator('Common_File');
    indicator.setTotal(tasks.length);
    let folderMapping = new Map();

    for (let i = 0; i < _tasks.length; i++) {
        const list = _tasks[i];
        let down_tasks = [];
        for (let j = 0; j < list.length; j++) {
            const task = list[j];

            // 切换到根目录
            await API.Utils.siwtchToRoot();

            // 创建文件夹
            let folderName = QZone.Common.Config.ZIP_NAME + '/' + task.dir;
            if (!folderMapping.has(folderName)) {
                let folderEntry = await API.Utils.createFolder(folderName);
                folderMapping.set(folderName, folderEntry);
            }

            let filepath = folderName + '/' + task.name;
            down_tasks.push(API.Utils.writeFile(task.url, filepath).then(() => {
                task.setState('complete');
                indicator.addSuccess(task);
            }).catch((error) => {
                indicator.addFailed(task);
                task.setState('interrupted');
                console.error('下载文件异常', task, error);
            }));
        }
        await Promise.all(down_tasks);
    }
    indicator.complete();
    return true;
}

/**
 * 通过浏览器下载文件
 * @param {BrowserTask} tasks 浏览器下载任务
 */
API.Utils.downloadsByBrowser = async (tasks) => {
    let indicator = new StatusIndicator('Common_Browser');
    indicator.setTotal(tasks.length);
    // 开始下载
    const _tasks = _.chunk(tasks, Qzone_Config.Common.downloadThread);
    for (let i = 0; i < _tasks.length; i++) {
        const list = _tasks[i];
        for (let j = 0; j < list.length; j++) {
            const task = list[j];
            await API.Utils.downloadByBrowser(task);
            indicator.addSuccess(1);
        }
        // 等待1秒再继续添加
        await API.Utils.sleep(1000);
    }
    indicator.complete();
    return true;
}

/**
 * 通过迅雷下载
 * @param {ThunderInfo} thunderInfo 迅雷下载信息
 */
API.Utils.invokeThunder = async (thunderInfo) => {
    let indicator = new StatusIndicator('Common_Thunder');
    indicator.setTotal(thunderInfo.tasks.length);
    // 通过迅雷任务数将任务分组，任务太大时无法唤起迅雷
    let tasks = thunderInfo.tasks;
    const _tasks = _.chunk(tasks, Qzone_Config.Common.thunderTaskNum);
    for (let i = 0; i < _tasks.length; i++) {
        let index = i + 1;
        indicator.setIndex(index);
        const list = _tasks[i];
        let taskGroupName = thunderInfo.taskGroupName;
        if (_tasks.length > 1) {
            taskGroupName = taskGroupName + "_" + index;
        }
        const _list = JSON.parse(JSON.stringify(list))
        for (const _temp of _list) {
            delete _temp.downloadState;
            delete _temp.source;
        }
        let groupTask = new ThunderInfo(taskGroupName, Qzone_Config.Common.downloadThread, _list)
        API.Utils.downloadByThunder(groupTask);
        indicator.addSuccess(_list);
        if (index < _tasks.length) {
            let sleep = Qzone_Config.Common.thunderTaskSleep * 1;
            let interId = setInterval(function () {
                indicator.setNextTip(--sleep);
            }, 1000)
            // 等待指定秒再继续唤起，并给用户提示
            await API.Utils.sleep(sleep * 1000);
            clearInterval(interId);
        }
    }
    indicator.complete();
}

/**
 * 下载文件
 */
API.Utils.downloadAllFiles = async () => {
    let downloadType = Qzone_Config.Common.downloadType;
    if (downloadType === 'QZone') {
        // 使用QQ空间外链时，不需要下载文件
        return;
    }
    if (downloadTasks.length === 0 || thunderInfo.tasks.length === 0 || browserTasks.length === 0) {
        // 没有下载任务的时候，不调用下载逻辑
        return;
    }
    switch (downloadType) {
        case 'File':
            await API.Utils.downloadsByAjax(downloadTasks);
            break;
        case 'Thunder':
            await API.Utils.invokeThunder(thunderInfo);
            break;
        case 'Browser':
            await API.Utils.downloadsByBrowser(browserTasks);
            break;
        default:
            console.warn('未识别类型', downloadType);
            break;
    }
}

/**
 * 获取下载任务
 */
API.Utils.getDownloadTasks = () => {
    // 下载方式
    let downloadType = Qzone_Config.Common.downloadType;
    let tasks = [];
    switch (downloadType) {
        case 'File':
            tasks = downloadTasks;
            break;
        case 'Browser':
            tasks = browserTasks;
            break;
        case 'Thunder':
            tasks = thunderInfo.tasks;
            break;
        default:
            break;
    }
    return tasks;
}

/**
 * 获取下载失败的下载任务
 */
API.Utils.getFailedTasks = () => {
    // 下载方式
    let downloadType = Qzone_Config.Common.downloadType;
    let tasks = [];
    switch (downloadType) {
        case 'File':
            for (const downloadTask of downloadTasks) {
                if (downloadTask.success) {
                    continue;
                }
                tasks.push(downloadTask);
            }
            break;
        case 'Browser':
            tasks = browserTasks;
            break;
        case 'Thunder':
            tasks = thunderInfo.tasks;
            break;
        default:
            break;
    }
    return tasks;
}