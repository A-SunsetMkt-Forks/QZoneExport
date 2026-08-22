/**
 * QQ空间Rest API地址（移植自 src/js/api.js REST_URLS，逐项等价）
 */
export const REST_URLS = {
    /** 个人信息 url */
    USER_INFO_URL: 'https://user.qzone.qq.com/proxy/domain/base.qzone.qq.com/cgi-bin/user/cgi_userinfo_get_all',
    /** 说说列表URL */
    MESSAGES_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6',
    /** 说说详情URL */
    MESSAGES_DETAIL_URL: 'https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msgdetail_v6',
    /** 说说配图URL */
    MESSAGES_IMAGES_URL: 'https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_get_pics_v6',
    /** 说说、视频评论列表URL */
    MESSAGES_VIDEOS_COMMONTS_URL:
        'https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getcmtreply_v6',
    /** 语音详情URL */
    MESSAGES_VOICE_INFO_URL: 'https://user.qzone.qq.com/proxy/domain/snsapp.qzone.qq.com/cgi-bin/sound/GetVoice',
    /** 日志列表URL */
    BLOGS_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/b.qzone.qq.com/cgi-bin/blognew/get_abs',
    /** 日志阅读数URL */
    BLOGS_READ_COUNT_URL: 'https://user.qzone.qq.com/proxy/domain/b.qzone.qq.com/cgi-bin/blognew/get_count',
    /** 日志评论列表URL */
    BLOGS_COMMENTS_URL: 'https://user.qzone.qq.com/proxy/domain/b.qzone.qq.com/cgi-bin/blognew/get_comment_list',
    /** 日志详情URL */
    BLOGS_INFO_URL: 'https://user.qzone.qq.com/proxy/domain/b.qzone.qq.com/cgi-bin/blognew/blog_output_data',
    /** 私密日志列表URL */
    DIARY_LIST_URL:
        'https://user.qzone.qq.com/proxy/domain/b.qzone.qq.com/cgi-bin/privateblog/privateblog_get_titlelist',
    /** 私密日志详情URL */
    DIARY_INFO_URL:
        'https://user.qzone.qq.com/proxy/domain/b.qzone.qq.com/cgi-bin/privateblog/privateblog_output_data',
    /** 相册路由URL */
    PHOTOS_ROUTE_URL: 'https://user.qzone.qq.com/proxy/domain/route.store.qq.com/GetRoute',
    /** 相册列表URL */
    ALBUM_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/fcgi-bin/fcg_list_album_v3',
    /** 相册、相片评论列表URL */
    ALBUM_PHOTOS_COMMENTS_URL:
        'https://user.qzone.qq.com/proxy/domain/app.photo.qzone.qq.com/cgi-bin/app/cgi_pcomment_xml_v2',
    /** 相片列表URL */
    IMAGES_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/fcgi-bin/cgi_list_photo',
    /** 相片详情URL */
    IMAGES_INFO_URL: 'https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/fcgi-bin/cgi_floatview_photo_list_v2',
    /** 好友列表URL */
    FRIENDS_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/tfriend/friend_show_qqfriends.cgi',
    /** 好友列表URL（排序） */
    FRIENDS_SORT_LIST_URL: 'https://mobile.qzone.qq.com/friend/mfriend_list',
    /** 好友互动信息 */
    FRIENDSHIP_INFO_URL: 'https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/friendship/cgi_friendship',
    /** 留言列表URL */
    BOARD_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/m.qzone.qq.com/cgi-bin/new/get_msgb',
    /** 视频列表URL */
    VIDEO_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/video_get_data',
    /** 我的收藏 */
    FAVORITE_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/fav.qzone.qq.com/cgi-bin/get_fav_list',
    /** 分享列表 */
    SHARE_LIST_URL:
        'https://user.qzone.qq.com/p/h5/pc/api/sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzsharegetmylistbytype',
    /** 分享评论 */
    SHARE_COMMENTS_URL: 'https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshareget_comment',
    /** 点赞数目 */
    LIKE_COUNT_URL: 'https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/qz_opcnt2',
    /** 点赞列表 */
    LIKE_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/users.qzone.qq.com/cgi-bin/likes/get_like_list_app',
    /** 说说、日志浏览记录列表 */
    VISITOR_SINGLE_LIST_URL:
        'https://user.qzone.qq.com/proxy/domain/g.qzone.qq.com/cgi-bin/friendshow/cgi_get_visitor_single',
    /** 相册浏览记录列表 */
    VISITOR_SIMPLE_LIST_URL:
        'https://user.qzone.qq.com/proxy/domain/g.qzone.qq.com/cgi-bin/friendshow/cgi_get_visitor_simple',
    /** 空间访问记录 */
    VISITOR_MORE_LIST_URL:
        'https://user.qzone.qq.com/proxy/domain/g.qzone.qq.com/cgi-bin/friendshow/cgi_get_visitor_more',
    /** 特别关心列表（含被关心个数） */
    SPECIAL_CARE_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/tfriend/specialcare_get.cgi',
    /** 好友/用户名片 */
    USER_CARD_URL: 'https://h5.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/cgi_personal_card',
    /** 获取坐标地址信息 */
    MAP_LBS_INFO: 'https://apis.map.qq.com/ws/geocoder/v1',
    /** 转换坐标信息 */
    TO_TX_LBS: 'https://apis.map.qq.com/ws/coord/v1/translate',
    /** 个人统计，用来保持心跳，避免会话短时间内失效 */
    FEEDS_COUNT: 'https://user.qzone.qq.com/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/cgi_get_feeds_count.cgi',
} as const;

export type RestUrlKey = keyof typeof REST_URLS;
