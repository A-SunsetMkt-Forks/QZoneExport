import { describe, expect, it } from 'vitest';
import {
    type IncrementConfig,
    type IncrementItem,
    isFullBackup,
    isNewItem,
    isPreBackupPos,
    removeNewItems,
    removeOldItems,
    unionBackedUpItems,
} from '../core/collector/increment';
import { isGetNextPage } from '../core/collector/modules/helpers';
import { getItemField } from '../core/shared/utils';

const fullCfg: IncrementConfig = { IncrementType: 'Full', IncrementTime: '2020-01-01 00:00:00', IncrementField: 'created_time' };
const customCfg: IncrementConfig = { IncrementType: 'Custom', IncrementTime: '2020-01-01 00:00:00', IncrementField: 'created_time' };

const sec = (dateStr: string) => Math.floor(new Date(dateStr).getTime() / 1000);

describe('增量备份判断', () => {
    it('isFullBackup / isNewItem', () => {
        expect(isFullBackup(fullCfg)).toBe(true);
        expect(isFullBackup(customCfg)).toBe(false);
        expect(isNewItem({})).toBe(true);
        expect(isNewItem({ isNewItem: false })).toBe(false);
    });

    it('全量备份时旧数据清空、新数据全保留', () => {
        const oldItems = [{ created_time: sec('2019-06-01') }];
        const newItems = [{ created_time: sec('2019-06-01') }];
        expect(removeOldItems(oldItems, fullCfg)).toEqual([]);
        expect(removeNewItems(newItems, fullCfg).length).toBe(1);
    });

    it('自定义增量：旧数据移除晚于增量时间的项并打旧标', () => {
        const oldItems: IncrementItem[] = [
            { created_time: sec('2020-06-01') }, // 晚于增量时间，应移除
            { created_time: sec('2019-06-01') }, // 保留并打 isNewItem=false
        ];
        const result = removeOldItems(oldItems, customCfg);
        expect(result.length).toBe(1);
        expect(result[0]!.isNewItem).toBe(false);
    });

    it('自定义增量：新数据移除早于增量时间的项并打新标', () => {
        const newItems: IncrementItem[] = [
            { created_time: sec('2020-06-01') }, // 保留并打 isNewItem=true
            { created_time: sec('2019-06-01') }, // 早于增量时间，应移除
        ];
        const result = removeNewItems(newItems, customCfg);
        expect(result.length).toBe(1);
        expect(result[0]!.isNewItem).toBe(true);
    });

    it('unionBackedUpItems合并新老数据（新在前）', () => {
        const oldItems = [{ id: 'old', created_time: sec('2019-06-01') }];
        const newItems = [{ id: 'new', created_time: sec('2020-06-01') }];
        const merged = unionBackedUpItems(customCfg, oldItems, newItems);
        expect(merged.map((item) => item.id)).toEqual(['new', 'old']);
    });

    it('旧数据为空时直接返回新数据', () => {
        const newItems = [{ id: 'new', created_time: sec('2019-01-01') }];
        expect(unionBackedUpItems(customCfg, [], newItems)).toBe(newItems);
    });

    it('isPreBackupPos：全量或空数据返回false', () => {
        expect(isPreBackupPos([], customCfg)).toBe(false);
        expect(isPreBackupPos([{ created_time: sec('2020-06-01') }], fullCfg)).toBe(false);
    });

    it('isPreBackupPos：数据跨越增量时间点返回true', () => {
        // 数据从新到旧：最后一条早于增量时间 → incrementTime >= lastTime 命中
        const items = [{ created_time: sec('2020-06-01') }, { created_time: sec('2019-06-01') }];
        expect(isPreBackupPos(items, customCfg)).toBe(true);
    });

    it('getItemField：字段名大小写不敏感', () => {
        expect(getItemField({ uploadTime: 123 }, 'uploadtime')).toBe(123);
        expect(getItemField({ uploadtime: 123 }, 'uploadTime')).toBe(123);
        expect(getItemField({ pubTime: 1 }, 'pubtime')).toBe(1);
        expect(getItemField({ created_time: 5 }, 'created_time')).toBe(5);
        expect(getItemField({ foo: 1 }, 'bar')).toBeUndefined();
    });

    it('回归：IncrementField 缺失时 isPreBackupPos 永远 false（即「永不停止翻页」根因）', () => {
        const noField: IncrementConfig = { IncrementType: 'LastTime', IncrementTime: '2020-01-01 00:00:00', IncrementField: '' };
        const items = [{ created_time: sec('2019-06-01') }];
        expect(isPreBackupPos(items, noField)).toBe(false);
    });

    it('回归：配置 uploadTime 但条目带 uploadtime，仍能正确判定停止', () => {
        const cfg: IncrementConfig = { IncrementType: 'LastTime', IncrementTime: '2020-01-01 00:00:00', IncrementField: 'uploadTime' };
        const items = [{ uploadtime: sec('2019-06-01') }, { uploadtime: sec('2018-06-01') }];
        expect(isPreBackupPos(items, cfg)).toBe(true);
    });

    it('回归：配置 pubTime 但条目带 pubtime，仍能正确判定停止', () => {
        const cfg: IncrementConfig = { IncrementType: 'LastTime', IncrementTime: '2020-01-01 00:00:00', IncrementField: 'pubTime' };
        const items = [{ pubtime: sec('2019-06-01') }];
        expect(isPreBackupPos(items, cfg)).toBe(true);
    });

    it('isGetNextPage(LastTime)：旧数据存在且本页全早于增量时间 → 应停止翻页', () => {
        const lastCfg: IncrementConfig = { IncrementType: 'LastTime', IncrementTime: '2026-08-09 23:39:02', IncrementField: 'created_time' };
        const oldItems = [{ created_time: sec('2026-08-09') }];
        const pageItems = [{ created_time: sec('2019-01-01') }, { created_time: sec('2018-01-01') }];
        expect(isGetNextPage(oldItems, pageItems, lastCfg)).toBe(false);
    });
});
