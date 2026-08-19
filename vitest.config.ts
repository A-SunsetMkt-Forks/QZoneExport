import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // P2起核心域层单测放入 tests/ 目录
        include: ['tests/**/*.test.ts'],
        passWithNoTests: true,
    },
});
