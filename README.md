# 纸上生长 (paper-grow)

手绘风格的分层生长游戏：Vue 3 + Three.js + TypeScript + Vite。

```bash
npm i
npm run dev      # 开发
npm run build    # 类型检查 + 打包，产物 dist/ 可直接静态部署
```

可选埋点：复制 [.env.example](.env.example) 为 `.env.local`，设置 `VITE_ANALYTICS_URL` 为你的收集端点；不配置则不向远端发送埋点。`VITE_*` 会进入前端产物，不要填写密钥。

更改规则见 [AGENTS.md](AGENTS.md)，文件入口和验收清单见 [维护指南](docs/maintenance.md)。依赖安装生成的 `package-lock.json` 应纳入版本控制，后续干净环境使用 `npm ci`。

本项目每次更改完成且相关检查通过后，自动提交并推送到 [MatildaHan/grow](https://github.com/MatildaHan/grow)，除非该次任务明确要求不推送。
