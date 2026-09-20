# 前端开发指南

## 技术栈与选型

| 层 | 当前选择 | 职责 |
| --- | --- | --- |
| UI | React 19 + TypeScript | 页面与组件 |
| 状态 | Zustand 5 | 表单、会话、任务与设置 |
| 构建 | Vite 6 | 开发服务器与静态资源构建 |
| 样式 | 当前为自定义 CSS；后续选用 Tailwind CSS | 页面设计与接入另做，不引入 HeroUI |
| 包管理 | Bun，使用 `bun.lock` | 安装依赖与执行脚本 |
| 开发工具链 | Bun（CI 使用 1.3.9） | 沿用原作者的依赖管理、脚本与测试配置 |
| 测试 | Bun 内置测试（`bun:test`） | API/SSE、store 与服务端静态渲染测试 |
| 生产服务 | Go Launcher | 内嵌 `dist/`、控制面、代理转发 |

Bun 不是前端框架；它承担包管理、脚本运行和测试。项目沿用原作者的 Bun 工具链，开发与 CI 使用同一份锁文件。Tailwind 是 CSS 工具集，不提供完整的可访问组件；对话框、菜单、焦点管理与键盘交互仍需组件代码负责。

## 安装、运行、验证

先安装 Bun（建议与 CI 的 1.3.9 一致），然后在 `RWKV_Lightning_CUDA_Launcher/` 目录执行：

```bash
bun install --frozen-lockfile
bun run test
bun run lint
bun run build
```

联调需要两个终端。先构建本机 Client，再启动前端：

```bash
# 终端 A，位于 RWKV_Lightning_CUDA_Launcher
# dist 已构建；二进制会将它嵌入。
go build -o rwkv_launcher .
./rwkv_launcher --client

# 终端 B，同一目录
bun run dev
```

Vite 默认端口 5173，`/api`、`/v1`、`/logs` 代理到 `127.0.0.1:10721`。Go 未启动时前端页面可以加载，API 会失败。若要验证本机 runtime 启停，把 Launcher 放在原生二进制同目录并以全套形态启动；`go run .` 的临时目录不适合验证这个场景。

其他命令：`bun test --watch tests` 持续测试，`bun run test:go` 跑 Go race 测试，`bun run preview` 仅预览静态构建（不提供 Go 控制面）。生产只需 Go/原生二进制，无需 Node 或 Bun。

## 目录职责

```text
src/
  app/                  应用壳、导航、全局轮询
  pages/                Chat / Translate / Runtime / StateTuning / Settings
  components/           通用控件、模型 state / adapter 管理
  lib/api/              HTTP、推理接口、Launcher 接口、SSE parser
  lib/translate/        分段与调度逻辑
  stores/               Zustand 状态与本地持久化
  styles/
    globals.css         现有主题变量与通用样式
    aero.css            现有页面外观
tests/                 Bun 测试
docs/                  对接与开发文档
dist/                  已跟踪的生产构建；由 Go embed
```

Go 侧：`main.go` 管进程、CLI 参数与启动；`api.go` 管控制路由和鉴权；`request_types.go` 集中定义进程控制请求体；`backends.go` 管注册表和转发；`legacy.go` 管旧协议适配；`fsbrowse.go` 管目录白名单；`devices.go` 管选卡；`metrics*.go` 管指标。构建必须使用 `go build .`，不能只编译 `main.go`。

## 后续样式选型

前端改造确定使用 Tailwind CSS，不使用 HeroUI。本轮不安装 Tailwind、不修改页面、组件或样式；具体布局、视觉设计、组件体系及 Tailwind 接入由后续前端工作决定。

实施时需注意 Tailwind Preflight 与现有全局 CSS 的交互；统一规划 CSS layer、主题变量、dark/light/system 和组件迁移，避免两套全局样式相互覆盖。Tailwind 不代替可访问组件的焦点管理、键盘导航和交互逻辑。

## 多后端前端改造的起点

当前页面仍调用旧 alias，store 仍主要按单机组织。本轮代码与文档整理不代表多后端 UI 已完成。

先阅读 [联调指南](integration-guide.md)，再落实：

1. 建立 backend registry store、当前 backend ID 和统一同源请求前缀。
2. 让 runtime/jobs/模型/state/adapter 状态按 backend ID 隔离，清理切换节点后的旧请求。
3. 依据 capabilities / legacy / kind 实现功能降级及 Client 空状态。
4. 迁移页面至新控制面，接远端目录浏览、GPU 指标和 `visible_devices`。
5. Translate 显式调用 `/v1/batch/completions`；同批处理旧代理改写。

控制面参考文档中的 schema 是新接口契约。现有 `src/lib/api/launcher.ts` 仅描述旧页面当前使用的部分字段，不能把它当完整新 API 定义。

## 提交与构建产物

仅维护 `bun.lock`，不用第二份包管理锁文件。增减依赖后用 Bun 更新锁文件；CI 使用 frozen install，执行 lint/test/build 后编译 Go。

修改前端源码、依赖或样式后，应重新 `bun run build`，将 `dist/` 与源码、配置和锁文件一起提交。不要提交 node_modules、Go 本机二进制或临时缓存。Bun 测试中的静态渲染断言不等于浏览器视觉或真实 GPU 验收。
