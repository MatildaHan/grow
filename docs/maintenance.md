# 维护与验收

本项目是 Vue 3 + Three.js + TypeScript + Vite 的全屏生长游戏。AI 助手的执行与自动推送规则见 [AGENTS.md](../AGENTS.md)。

## 文件入口

| 位置 | 职责 |
| --- | --- |
| `src/App.vue`、`src/main.ts` | 页面入口、全局样式与错误上报 |
| `src/components/GameView.vue` | 画布、进度、提示、保存和重置按钮 |
| `src/components/ErrorBoundary.vue` | Vue 错误回退界面 |
| `src/core/Game.ts` | 阶段状态机、性能降档、输入、截图和生命周期 |
| `src/core/layers.ts` | 草地、天空、远山、小路、树、房屋、河流、麦田 |
| `src/core/materials.ts` | Shader、带状几何和纸纹叠层 |
| `src/core/types.ts` | 图层与输入接口、质量等级、共享辅助函数 |
| `src/core/analytics.ts` | 可选埋点队列与发送 |
| `vite.config.ts`、`tsconfig.json` | 相对资源路径、打包与严格类型检查 |

## 开发命令

首次安装执行 `npm install`，生成并提交 `package-lock.json`；有锁文件后，干净环境使用 `npm ci`。

```bash
npm run dev      # 本地开发
npm run build    # vue-tsc 类型检查，然后 Vite 打包
npm run preview  # 本地检查构建产物
```

构建输出为 `dist/`，不纳入 Git。当前 `base: './'` 支持相对资源路径；修改部署路径时需要检查实际资源加载。当前没有配置自动测试、lint 或 GitHub 部署工作流。

## 按改动影响验收

| 改动 | 必要检查 |
| --- | --- |
| 文档、注释 | 链接、文件路径、脚本名称与描述一致；差异无空白错误 |
| 页面文案、样式、Vue 组件 | `npm run build`；桌面与窄屏检查提示、进度、按钮、回退界面和安全区 |
| 游戏逻辑、输入、图层 | `npm run build`；点按开始、拖动生长、种树、盖房、八阶段依次完成、重置后再次开始 |
| 材质、Shader、相机、渲染 | `npm run build`；检查纸纹与层次、缩放和横竖屏、截图、后台恢复、降档和减少动态效果 |
| 依赖、构建或部署配置 | 审查依赖及锁文件；`npm run build`；用 `npm run preview` 检查产物与资源路径 |
| 埋点或错误处理 | `npm run build`；检查无端点时可运行、事件字段与发送行为、异常回退；不向真实端点发送测试数据 |

涉及完整游戏体验时，还要确认完成后可以保存 PNG、重新生长，并且重复重置不会明显累积资源或事件。WebGL 不可用或上下文丢失时，确认回退提示和重试路径。触屏体验需要实际触屏设备检查，浏览器窄屏检查不能代替它。

浏览器或设备检查不可用时，报告未覆盖的范围，不把构建通过等同于运行体验通过；需要该项验收的任务先保留本地更改。

## 交付

按 `AGENTS.md` 自动提交本任务更改并普通推送到用户指定仓库。报告实际完成的检查、提交号与远端分支；检查失败或推送受阻时说明原因。GitHub 推送和网站部署分别确认。
