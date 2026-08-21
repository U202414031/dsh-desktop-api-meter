# dsh-desktop-api-meter

API 设置与用量计量——注册 sidebar.api 插槽与 desktop.model-monitor 服务。

客户端插件，支持多供应商余额查询、高峰时段检测与用量标签页。

## 安装（git 依赖）

```bash
dsh plugin --profile desktop install git+https://github.com/U202414031/dsh-desktop-api-meter.git
```

> 也可在发布到 npm 后使用 `dsh plugin --profile desktop install dsh-desktop-api-meter@latest` 安装。

## 开发

```bash
yarn install
yarn build   # tsdown 产出 lib/
yarn typecheck
```

## 说明

- 面向 DeepSeek Harness Desktop（rc.7 开发，向上兼容 rc.8 运行时）。
- 与 DSH 生态一致：通过标准 Cordis bundle / 插槽机制组合，不修改宿主源码。

## License

MIT
