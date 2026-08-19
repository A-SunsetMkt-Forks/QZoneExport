import type { QzoneBackupConfig } from './types';
import { INCREMENT_FIELD_BY_MODULE, DEFAULT_INCREMENT_TIME } from '../increment';

/**
 * 全局配置解析：把 Common 全局默认值落实到各模块，使 collector 读取逻辑无需感知
 * 「全局 / 本地」差异。集中处理：
 *  - exportType：彻底全局，所有模块统一为 Common.exportType
 *  - IncrementField：技术常量（各模块增量比较字段），由 INCREMENT_FIELD_BY_MODULE 注入
 *  - 增量 / 点赞 / 评论 / 访客：默认继承 Common 公共默认（inherit !== false），
 *    各模块可设 inherit=false 取消继承、使用自身字段（不做迁移/兼容，旧配置无 inherit
 *    字段时按全局默认覆盖）
 */
export function resolveConfig(config: QzoneBackupConfig): QzoneBackupConfig {
    const exportType = config.Common?.exportType || 'HTML';
    const common = (config.Common || {}) as Record<string, any>;
    const resolved: Record<string, any> = { ...config };
    for (const name of Object.keys(config)) {
        if (name === 'Common' || name === 'Dev') {
            continue;
        }
        const m = (config as Record<string, any>)[name];
        if (!m || typeof m !== 'object') {
            continue;
        }
        const rm: Record<string, any> = { ...m, exportType };

        // 增量比较字段：写死的技术常量，按模块映射注入（不再存于配置）
        rm.IncrementField = INCREMENT_FIELD_BY_MODULE[name] ?? 'created_time';

        // 增量备份：默认继承 Common.Increment（含好友模块，统一管控其增量行为）。
        // 好友模块自身无 IncrementType/IncrementTime 字段，此处统一注入全局 IncrementType 作为判定依据。
        if (m.IncrementInherit !== false) {
            rm.IncrementType = common.Increment?.IncrementType ?? 'Full';
            if ('IncrementTime' in m) {
                rm.IncrementTime = common.Increment?.IncrementTime ?? DEFAULT_INCREMENT_TIME;
            }
        }

        // 点赞 / 评论 / 访客：默认继承 Common 对应组；模块自身 inherit===false 时保留自身字段
        for (const group of ['Like', 'Comments', 'Visitor']) {
            const g = m[group];
            if (g && typeof g === 'object' && g.inherit !== false) {
                rm[group] = common[group];
            }
        }

        // 相册图片级子模块（Images）同样继承 Common 公共默认：仅 Comments 参与点赞/评论/访客继承
        // （Images 下无 Like/Visitor 组，循环仅命中 Comments；inherit 由 config.Photos.Images.Comments.inherit 控制）
        const images = m.Images;
        if (images && typeof images === 'object') {
            const ri: Record<string, any> = { ...images };
            for (const group of ['Like', 'Comments', 'Visitor']) {
                const g = images[group];
                if (g && typeof g === 'object' && g.inherit !== false) {
                    ri[group] = common[group];
                }
            }
            rm.Images = ri;
        }

        resolved[name] = rm;
    }
    return resolved as QzoneBackupConfig;
}
