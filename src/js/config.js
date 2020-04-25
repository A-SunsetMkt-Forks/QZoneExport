// 默认配置
const Default_Config = {
    // 公共配置
    Common: {
        // 重试次数
        listRetryCount: 2,
        // 重试间隔
        listRetrySleep: 1,
        // 文件下载类型
        downloadType: 'File',
        // 自动识别文件后缀
        isAutoFileSuffix: true,
        // 后缀识别超时秒数
        autoFileSuffixTimeOut: 30,
        // 迅雷任务数        
        thunderTaskNum: 5000,
        // 唤起迅雷间隔        
        thunderTaskSleep: 60,
        // 文件下载并发数        
        downloadThread: 5,
        // 是否启用下载状态栏提醒
        enabledShelf: true
    },
    // 说说模块
    Messages: {
        exportType: "MarkDown",// 内容备份类型
        pageSize: 20,
        randomSeconds: {
            min: 1,
            max: 2
        },
        isFull: true, //是否获取全文
        Comments: {
            isFull: true, //是否全部评论
            pageSize: 20,
            randomSeconds: {
                min: 1,
                max: 2
            }
        }
    },
    // 日志模块
    Blogs: {
        exportType: "MarkDown",// 内容备份类型
        pageSize: 50,
        randomSeconds: {
            min: 1,
            max: 2
        },
        Info: {
            randomSeconds: {
                min: 1,
                max: 2
            }
        },
        Comments: {
            isFull: true, //是否全部评论
            pageSize: 50,
            randomSeconds: {
                min: 1,
                max: 2
            }
        }
    },
    // 私密日记模块
    Diaries: {
        exportType: "MarkDown",// 内容备份类型
        pageSize: 50,
        randomSeconds: {
            min: 1,
            max: 2
        },
        Info: {
            randomSeconds: {
                min: 1,
                max: 2
            }
        }
    },
    // 相册模块
    Photos: {
        exportType: "Folder",
        pageSize: 3000,
        randomSeconds: {
            min: 1,
            max: 2
        },
        Comments: {
            isGet: false, // 是否获取评论，默认不获取
            pageSize: 100,
            randomSeconds: {
                min: 1,
                max: 2
            }
        },
        Images: {
            exportType: "File",
            pageSize: 90,
            exifType: "raw",
            randomSeconds: {
                min: 1,
                max: 2
            },
            Comments: {
                isGet: false, // 是否获取评论，默认不获取
                pageSize: 100,
                randomSeconds: {
                    min: 1,
                    max: 2
                }
            }
        }
    },
    // 视频模块
    Videos: {
        exportType: "Link",
        randomSeconds: {
            min: 1,
            max: 2
        },
        pageSize: 20
    },
    // 留言板模块
    Boards: {
        exportType: "MarkDown",
        randomSeconds: {
            min: 1,
            max: 2
        },
        pageSize: 20
    },
    // QQ好友模块
    Friends: {
        exportType: "Excel",
        hasAddTime: true
    },
    // 收藏夹模块
    Favorites: {
        exportType: "MarkDown",
        randomSeconds: {
            min: 1,
            max: 2
        },
        pageSize: 30
    },
};

// 用户配置
let Qzone_Config = {
    // 公共配置
    Common: {
        // 重试次数
        listRetryCount: 2,
        // 重试间隔
        listRetrySleep: 1,
        // 文件下载类型
        downloadType: 'File',
        // 自动识别文件后缀
        isAutoFileSuffix: true,
        // 后缀识别超时秒数
        autoFileSuffixTimeOut: 30,
        // 迅雷任务数        
        thunderTaskNum: 5000,
        // 唤起迅雷间隔        
        thunderTaskSleep: 60,
        // 文件下载并发数        
        downloadThread: 5,
        // 是否启用下载状态栏提醒
        enabledShelf: true
    },
    // 说说模块
    Messages: {
        exportType: "MarkDown",// 内容备份类型
        pageSize: 20,
        randomSeconds: {
            min: 1,
            max: 2
        },
        isFull: true, //是否获取全文
        Comments: {
            isFull: true, //是否全部评论
            pageSize: 20,
            randomSeconds: {
                min: 1,
                max: 2
            }
        }
    },
    // 日志模块
    Blogs: {
        exportType: "MarkDown",// 内容备份类型
        pageSize: 50,
        randomSeconds: {
            min: 1,
            max: 2
        },
        Info: {
            randomSeconds: {
                min: 1,
                max: 2
            }
        },
        Comments: {
            isFull: true, //是否全部评论
            pageSize: 50,
            randomSeconds: {
                min: 1,
                max: 2
            }
        }
    },
    // 私密日记模块
    Diaries: {
        exportType: "MarkDown",// 内容备份类型
        pageSize: 50,
        randomSeconds: {
            min: 1,
            max: 2
        },
        Info: {
            randomSeconds: {
                min: 1,
                max: 2
            }
        }
    },
    // 相册模块
    Photos: {
        exportType: "Folder",
        pageSize: 3000,
        randomSeconds: {
            min: 1,
            max: 2
        },
        Comments: {
            isGet: false, // 是否获取评论，默认不获取
            pageSize: 100,
            randomSeconds: {
                min: 1,
                max: 2
            }
        },
        Images: {
            exportType: "File",
            pageSize: 90,
            exifType: "raw",
            randomSeconds: {
                min: 1,
                max: 2
            },
            Comments: {
                isGet: false, // 是否获取评论，默认不获取
                pageSize: 100,
                randomSeconds: {
                    min: 1,
                    max: 2
                }
            }
        }
    },
    // 视频模块
    Videos: {
        exportType: "Link",
        randomSeconds: {
            min: 1,
            max: 2
        },
        pageSize: 20
    },
    // 留言板模块
    Boards: {
        exportType: "MarkDown",
        randomSeconds: {
            min: 1,
            max: 2
        },
        pageSize: 20
    },
    // QQ好友模块
    Friends: {
        exportType: "Excel",
        hasAddTime: true
    },
    // 收藏夹模块
    Favorites: {
        exportType: "MarkDown",
        randomSeconds: {
            min: 1,
            max: 2
        },
        pageSize: 30
    },
};

const FOLDER_ROOT = '/QQ空间备份/';
const QZone = {
    Common: {
        ExportType: {
            "MESSAGES_LIST": true,
            "BLOG_LIST": true,
            "DIARY_LIST": true,
            "PHOTO_LIST": true,
            "VIDEO_LIST": true,
            "BOARD_LIST": true,
            "FRIEND_LIST": true,
            "FAVORITE_LIST": true
        },
        Owner: {
            uin: undefined,
            name: undefined
        },
        Target: {
            uin: undefined,
            name: undefined,
            title: undefined,
            route: 102
        },
        Config: {
            ZIP_NAME: 'QQ空间备份'
        },
        FILE_URLS: new Map(),
        Zip: window['JSZip'] ? new JSZip() : undefined,
        MD: window['TurndownService'] ? new TurndownService() : undefined,
        Filer: window['Filer'] ? new Filer() : undefined
    },
    // 用户信息
    User: {
        ROOT: FOLDER_ROOT + '其他'
    },
    // QQ好友模块
    Friends: {
        ROOT: FOLDER_ROOT + '好友',
        Data: []
    },
    // 日志模块
    Blogs: {
        ROOT: FOLDER_ROOT + '日志',
        IMAGES_ROOT: FOLDER_ROOT + '日志/图片',
        Data: [],
        FILE_URLS: new Map()
    },
    // 私密日记模块
    Diaries: {
        ROOT: FOLDER_ROOT + '私密日记',
        IMAGES_ROOT: FOLDER_ROOT + '私密日记/图片',
        Data: [],
        FILE_URLS: new Map()
    },
    // 相册模块
    Photos: {
        ROOT: FOLDER_ROOT + '相册',
        Album: {
            total: 0,
            Data: []
        },
        Images: {

        },
        // 相册分类
        Class: {
            100: "最爱",
            101: "人物",
            102: "风景",
            103: "动物",
            104: "游记",
            105: "卡通",
            106: "生活",
            107: "其他"
        },
        // 相册权限
        Access: {
            1: "所有人可见",
            2: "密码访问",
            3: "仅自己可见",
            4: "QQ好友可见",
            5: "回答问题的人可见",
            6: "部分好友可见",
            8: "部分好友不可见"
        },
        // 相册权限分类
        AccessType: {
            1: "公开",
            3: "仅主人可见",
            4: "好友和同学可见"
        },
        // 相册类型
        ViewType: {
            1: "个性",
            5: "亲子",
            6: "旅游",
            7: "校友"
        },
        FILE_URLS: new Map()
    },
    // 视频模块
    Videos: {
        ROOT: FOLDER_ROOT + '视频',
        Data: [],
        FILE_URLS: new Map()
    },
    // 说说模块
    Messages: {
        ROOT: FOLDER_ROOT + '说说',
        IMAGES_ROOT: FOLDER_ROOT + '说说/图片',
        Data: [],
        FILE_URLS: new Map()
    },
    // 留言板模块
    Boards: {
        ROOT: FOLDER_ROOT + '留言板',
        Data: [],
        FILE_URLS: new Map()
    },
    // 收藏夹模块
    Favorites: {
        ROOT: FOLDER_ROOT + '收藏夹',
        Data: [],
        FILE_URLS: new Map()
    }
};